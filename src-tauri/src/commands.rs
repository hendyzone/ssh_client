/// 返回应用版本，供前端验证 IPC 通路。
pub fn app_health() -> String {
    format!("hendyzone-ssh {}", env!("CARGO_PKG_VERSION"))
}

#[tauri::command]
pub fn health() -> String {
    app_health()
}

use crate::credential_vault;
use crate::models::{Group, Host};
use crate::session_manager::{spawn_session, SessionManager};
use crate::ssh_session::{Auth, Cmd};
use crate::{connection_store as cs, Db};
use tauri::{AppHandle, Emitter, State};

/// 统一将错误转为字符串，便于 Tauri 命令返回 Result<_, String>。
fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// 若主机开启 tmux，构造在 PTY 上 exec 的命令：接入或新建同名 tmux 会话（断线重连可恢复）。
/// 会话名仅保留 [A-Za-z0-9_-]，其余替换为 `_`，因此可安全置于单引号内。
/// tmux 不存在时回退到登录 shell，避免直接断开造成困惑。
fn tmux_command(host: &Host) -> Option<String> {
    if !host.use_tmux {
        return None;
    }
    let raw = host.tmux_session.as_deref().unwrap_or("main");
    let mut name: String = raw
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect();
    if name.is_empty() {
        name = "main".to_string();
    }
    Some(format!(
        "command -v tmux >/dev/null 2>&1 && exec tmux new-session -A -D -s '{name}' || exec \"${{SHELL:-/bin/sh}}\" -l"
    ))
}

#[tauri::command]
pub fn list_groups_cmd(db: State<Db>) -> Result<Vec<Group>, String> {
    let c = db.0.lock().map_err(map_err)?;
    cs::list_groups(&c).map_err(map_err)
}

#[tauri::command]
pub fn create_group_cmd(
    db: State<Db>,
    name: String,
    parent_id: Option<String>,
) -> Result<Group, String> {
    let c = db.0.lock().map_err(map_err)?;
    cs::create_group(&c, &name, parent_id.as_deref()).map_err(map_err)
}

#[tauri::command]
pub fn rename_group_cmd(db: State<Db>, id: String, name: String) -> Result<(), String> {
    let c = db.0.lock().map_err(map_err)?;
    cs::rename_group(&c, &id, &name).map_err(map_err)
}

#[tauri::command]
pub fn delete_group_cmd(db: State<Db>, id: String) -> Result<(), String> {
    let c = db.0.lock().map_err(map_err)?;
    cs::delete_group(&c, &id).map_err(map_err)
}

#[tauri::command]
pub fn list_hosts_cmd(db: State<Db>) -> Result<Vec<Host>, String> {
    let c = db.0.lock().map_err(map_err)?;
    cs::list_hosts(&c).map_err(map_err)
}

#[tauri::command]
pub fn upsert_host_cmd(db: State<Db>, host: Host) -> Result<(), String> {
    let c = db.0.lock().map_err(map_err)?;
    cs::upsert_host(&c, &host).map_err(map_err)
}

/// 保存主机：写库 + （若提供机密）存入钥匙串并把 credential_ref 设为 host.id。
///
/// `secret` 的含义随 host.auth_type 而定：密码认证时是登录密码，密钥认证时是私钥口令（可空）。
/// 机密只在这里短暂经过后端，存入钥匙串后不再返回前端。auth_type / key_path 由前端决定，后端不再覆盖。
#[tauri::command]
pub fn save_host_cmd(db: State<Db>, mut host: Host, secret: Option<String>) -> Result<(), String> {
    if let Some(s) = secret {
        if !s.is_empty() {
            credential_vault::store(&host.id, &s)?;
            host.credential_ref = Some(host.id.clone());
        }
    }
    let c = db.0.lock().map_err(map_err)?;
    cs::upsert_host(&c, &host).map_err(map_err)
}

#[tauri::command]
pub fn delete_host_cmd(db: State<Db>, id: String) -> Result<(), String> {
    // 先取出 host 看是否有 credential_ref，删库后清钥匙串。
    let credential_ref = {
        let c = db.0.lock().map_err(map_err)?;
        let host = cs::get_host(&c, &id).map_err(map_err)?;
        cs::delete_host(&c, &id).map_err(map_err)?;
        host.and_then(|h| h.credential_ref)
    };
    if let Some(r) = credential_ref {
        credential_vault::delete(&r)?;
    }
    Ok(())
}

/// 建立 SSH 会话：按 host_id 读库 + 从钥匙串取密码，再建链开 PTY。
///
/// 重要并发约束：rusqlite 的 Connection / MutexGuard 不是 Send，不能跨 await 持有。
/// 因此在 await 之前同步取出 host 信息和密码并释放锁，再 await spawn_session。
#[tauri::command]
pub async fn connect_cmd(
    app: AppHandle,
    db: State<'_, Db>,
    sessions: State<'_, SessionManager>,
    session_id: String,
    host_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    // —— 同步段：取 host + 认证凭据 + 已知指纹，随即释放锁 ——
    let (address, port, username, auth, command, host_key, expected_fp) = {
        let c = db.0.lock().map_err(map_err)?;
        let host = cs::get_host(&c, &host_id)
            .map_err(map_err)?
            .ok_or_else(|| "主机不存在".to_string())?;
        let command = tmux_command(&host);
        // 按认证方式组装凭据：密钥口令 / 登录密码均从钥匙串按 host.id 取。
        let auth = match host.auth_type.as_str() {
            "key" => {
                let path = host
                    .key_path
                    .clone()
                    .filter(|p| !p.is_empty())
                    .ok_or_else(|| "该主机未配置私钥路径，请先编辑主机选择私钥".to_string())?;
                // 私钥口令可选：有 credential_ref 则取，取不到当作无口令。
                let passphrase = match host.credential_ref.as_deref() {
                    Some(r) => credential_vault::get(r)?,
                    None => None,
                };
                Auth::Key { path, passphrase }
            }
            _ => {
                let password = match host.credential_ref.as_deref() {
                    Some(r) => credential_vault::get(r)?
                        .ok_or_else(|| "未找到该主机的已保存凭据，请先在主机编辑里填写密码".to_string())?,
                    None => return Err("该主机未配置密码凭据，请先编辑主机填写密码".to_string()),
                };
                Auth::Password(password)
            }
        };
        let host_key = format!("{}:{}", host.address, host.port);
        let expected_fp = cs::get_known_fingerprint(&c, &host_key).map_err(map_err)?;
        drop(c);
        (host.address, host.port, host.username, auth, command, host_key, expected_fp)
    };

    let is_first = expected_fp.is_none();

    // —— 异步段：建链（含指纹校验）——
    let app_data = app.clone();
    let sid_data = session_id.clone();
    let app_close = app.clone();
    let sid_close = session_id.clone();

    let (tx, actual_fp) = spawn_session(
        address,
        port,
        username,
        auth,
        expected_fp,
        cols,
        rows,
        command,
        move |chunk| {
            let _ = app_data.emit(&format!("ssh://{sid_data}/data"), chunk);
        },
        move || {
            let _ = app_close.emit(&format!("ssh://{sid_close}/closed"), ());
        },
    )
    .await?;

    // —— 首次连接：记录指纹（TOFU）——
    if is_first {
        let c = db.0.lock().map_err(map_err)?;
        cs::set_known_fingerprint(&c, &host_key, &actual_fp).map_err(map_err)?;
    }

    sessions.register(session_id, tx);
    Ok(())
}

/// 向会话写入字节（终端键盘输入）。
#[tauri::command]
pub fn write_cmd(
    sessions: State<SessionManager>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    if sessions.send(&session_id, Cmd::Write(data)) {
        Ok(())
    } else {
        Err("no such session".into())
    }
}

/// 调整会话窗口大小。
#[tauri::command]
pub fn resize_cmd(
    sessions: State<SessionManager>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    if sessions.send(&session_id, Cmd::Resize(cols, rows)) {
        Ok(())
    } else {
        Err("no such session".into())
    }
}

/// 关闭会话并从注册表移除。
#[tauri::command]
pub fn close_cmd(sessions: State<SessionManager>, session_id: String) -> Result<(), String> {
    sessions.send(&session_id, Cmd::Close);
    sessions.remove(&session_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_includes_name() {
        assert!(app_health().starts_with("hendyzone-ssh "));
    }
}

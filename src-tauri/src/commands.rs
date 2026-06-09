/// 返回应用版本，供前端验证 IPC 通路。
pub fn app_health() -> String {
    format!("ssh-client {}", env!("CARGO_PKG_VERSION"))
}

#[tauri::command]
pub fn health() -> String {
    app_health()
}

use crate::models::{Group, Host};
use crate::session_manager::{spawn_session, SessionManager};
use crate::ssh_session::Cmd;
use crate::{connection_store as cs, Db};
use tauri::{AppHandle, Emitter, State};

/// 统一将错误转为字符串，便于 Tauri 命令返回 Result<_, String>。
fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
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

#[tauri::command]
pub fn delete_host_cmd(db: State<Db>, id: String) -> Result<(), String> {
    let c = db.0.lock().map_err(map_err)?;
    cs::delete_host(&c, &id).map_err(map_err)
}

/// 建立 SSH 会话：建链 + 开 PTY，并把远端输出 / 关闭事件发回前端。
///
/// 异步命令的 `State` 必须带生命周期参数 `State<'_, T>`。
#[tauri::command]
pub async fn connect_cmd(
    app: AppHandle,
    sessions: State<'_, SessionManager>,
    session_id: String,
    address: String,
    port: u16,
    username: String,
    password: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let app_data = app.clone();
    let sid_data = session_id.clone();
    let app_close = app.clone();
    let sid_close = session_id.clone();

    let tx = spawn_session(
        address,
        port,
        username,
        password,
        cols,
        rows,
        move |chunk| {
            let _ = app_data.emit(&format!("ssh://{sid_data}/data"), chunk);
        },
        move || {
            let _ = app_close.emit(&format!("ssh://{sid_close}/closed"), ());
        },
    )
    .await?;

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
        assert!(app_health().starts_with("ssh-client "));
    }
}

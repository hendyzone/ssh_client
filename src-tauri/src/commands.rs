/// 返回应用版本，供前端验证 IPC 通路。
pub fn app_health() -> String {
    format!("ssh-client {}", env!("CARGO_PKG_VERSION"))
}

#[tauri::command]
pub fn health() -> String {
    app_health()
}

use crate::models::{Group, Host};
use crate::{connection_store as cs, Db};
use tauri::State;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_includes_name() {
        assert!(app_health().starts_with("ssh-client "));
    }
}

mod commands;
mod connection_store;
mod db;
mod models;
mod session_manager;
mod ssh_session;

use std::sync::Mutex;
use rusqlite::Connection;

/// 全局数据库状态，用 Mutex 保证线程安全。
pub struct Db(pub Mutex<Connection>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            use tauri::Manager;
            let dir = app.path().app_data_dir().expect("无法获取 app data 目录");
            std::fs::create_dir_all(&dir).ok();
            let conn = Connection::open(dir.join("ssh-client.db")).expect("打开数据库失败");
            db::init_schema(&conn).expect("初始化数据库 schema 失败");
            app.manage(Db(Mutex::new(conn)));
            app.manage(session_manager::SessionManager::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::health,
            commands::list_groups_cmd,
            commands::create_group_cmd,
            commands::rename_group_cmd,
            commands::delete_group_cmd,
            commands::list_hosts_cmd,
            commands::upsert_host_cmd,
            commands::delete_host_cmd,
            commands::connect_cmd,
            commands::write_cmd,
            commands::resize_cmd,
            commands::close_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用时出错");
}

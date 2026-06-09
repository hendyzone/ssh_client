/// 返回应用版本，供前端验证 IPC 通路。
pub fn app_health() -> String {
    format!("ssh-client {}", env!("CARGO_PKG_VERSION"))
}

#[tauri::command]
pub fn health() -> String {
    app_health()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_includes_name() {
        assert!(app_health().starts_with("ssh-client "));
    }
}

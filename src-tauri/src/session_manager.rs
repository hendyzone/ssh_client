//! 会话管理器：维护活跃 SSH 会话的注册表，并提供建链 + 启动读写循环的入口。
//!
//! 复用 `ssh_session` 已有的 `connect_password` / `PtySession` / `Cmd`，
//! 不在此重复定义 `Cmd`。

use crate::ssh_session::{connect, Auth, Cmd, PtySession};
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::mpsc;

/// 活跃会话注册表：session_id -> 该会话任务的指令发送端。
#[derive(Default)]
pub struct SessionManager {
    inner: Mutex<HashMap<String, mpsc::UnboundedSender<Cmd>>>,
}

impl SessionManager {
    /// 注册一个会话的指令发送端。
    pub fn register(&self, id: String, tx: mpsc::UnboundedSender<Cmd>) {
        self.inner.lock().unwrap().insert(id, tx);
    }

    /// 向指定会话投递指令；会话不存在或发送失败返回 false。
    pub fn send(&self, id: &str, cmd: Cmd) -> bool {
        match self.inner.lock().unwrap().get(id) {
            Some(tx) => tx.send(cmd).is_ok(),
            None => false,
        }
    }

    /// 从注册表移除会话。
    pub fn remove(&self, id: &str) {
        self.inner.lock().unwrap().remove(id);
    }
}

/// 建链（带 TOFU 指纹校验）、开 PTY，启动读写循环。
/// 返回 (会话指令发送端, 服务器实际公钥指纹)。
pub async fn spawn_session(
    addr: String,
    port: u16,
    username: String,
    auth: Auth,
    expected_fp: Option<String>,
    cols: u32,
    rows: u32,
    on_data: impl Fn(Vec<u8>) + Send + 'static,
    on_close: impl Fn() + Send + 'static,
) -> Result<(mpsc::UnboundedSender<Cmd>, String), String> {
    let (handle, fp) = connect(&addr, port, &username, auth, expected_fp).await?;
    let session = PtySession::open(&handle, cols, rows)
        .await
        .map_err(|e| e.to_string())?;
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<Cmd>();
    tokio::spawn(session.run(cmd_rx, on_data, on_close));
    Ok((cmd_tx, fp))
}

#[cfg(test)]
mod tests {
    use super::*;

    // 集成测试：直接通过 manager 建会话、写 echo、确认 on_data 收到回显结果。
    // 需要先运行本地 sshd 容器（127.0.0.1:2222 tester/testpass）。
    //   cargo test session_manager::tests::manager_spawns_and_echoes -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn manager_spawns_and_echoes() {
        let mgr = SessionManager::default();
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Vec<u8>>();

        let (tx, _fp) = spawn_session(
            "127.0.0.1".into(),
            2222,
            "tester".into(),
            Auth::Password("testpass".into()),
            None,
            80,
            24,
            move |chunk| {
                let _ = out_tx.send(chunk);
            },
            || {},
        )
        .await
        .expect("manager 应当成功建立会话");

        mgr.register("s1".into(), tx);
        assert!(mgr.send("s1", Cmd::Write(b"echo hello_mgr\n".to_vec())));

        let mut got = String::new();
        let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(5);
        while tokio::time::Instant::now() < deadline {
            if let Ok(Some(chunk)) = tokio::time::timeout(
                tokio::time::Duration::from_millis(500),
                out_rx.recv(),
            )
            .await
            {
                got.push_str(&String::from_utf8_lossy(&chunk));
                if got.contains("hello_mgr") {
                    break;
                }
            }
        }

        assert!(mgr.send("s1", Cmd::Close));
        mgr.remove("s1");
        assert!(!mgr.send("s1", Cmd::Write(b"x".to_vec())), "移除后不应再能发送");
        assert!(got.contains("hello_mgr"), "应收到 echo 回显, got: {got}");
    }
}

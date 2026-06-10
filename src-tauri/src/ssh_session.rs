//! SSH 会话：基于 russh 实现建链 + 密码认证。
//!
//! 阶段一只做"连得上、密码认证通过"，主机密钥指纹校验留到后续阶段。
//! 注意：russh 0.61 的 API 与早期版本（0.45）差异较大，下方均按 0.61 实现。

use russh::client;
use russh::keys::{load_secret_key, ssh_key, PrivateKeyWithHashAlg};
use russh::ChannelMsg;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

/// 认证方式：密码或私钥（私钥可带口令）。
pub enum Auth {
    Password(String),
    Key {
        /// 私钥文件路径。
        path: String,
        /// 私钥口令（passphrase），无口令则为 None。
        passphrase: Option<String>,
    },
}

/// 客户端回调处理器，携带 TOFU 指纹校验状态。
pub struct Client {
    /// 连接前从 known_hosts 查出的期望指纹；None 表示首次连接（TOFU）。
    expected_fp: Option<String>,
    /// 回传实际服务器公钥指纹给 connect_password。
    actual_fp: Arc<Mutex<Option<String>>>,
    /// 指纹不匹配标志，用于把 connect 失败语义化为"指纹变更"。
    mismatch: Arc<Mutex<bool>>,
}

impl client::Handler for Client {
    type Error = russh::Error;

    /// TOFU 校验：计算服务器公钥 SHA256 指纹并回传；
    /// 已有期望指纹且不符 → 设 mismatch 标志并返回 Ok(false)（russh 会在认证前断开，密码不外泄）；
    /// 首次（expected=None）或匹配 → Ok(true)。
    async fn check_server_key(
        &mut self,
        server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let fp = server_public_key
            .fingerprint(ssh_key::HashAlg::Sha256)
            .to_string();
        *self.actual_fp.lock().unwrap() = Some(fp.clone());
        match &self.expected_fp {
            Some(expected) if expected != &fp => {
                *self.mismatch.lock().unwrap() = true;
                Ok(false)
            }
            _ => Ok(true),
        }
    }
}

/// 建立已认证的 SSH 连接（密码或密钥），附带 TOFU 指纹校验。
///
/// `expected_fp`：known_hosts 中该主机的已知指纹；None 表示首次连接。
/// 返回 `(已认证句柄, 服务器实际公钥指纹)`；指纹变更时返回语义化错误。
pub async fn connect(
    addr: &str,
    port: u16,
    username: &str,
    auth: Auth,
    expected_fp: Option<String>,
) -> Result<(client::Handle<Client>, String), String> {
    let config = Arc::new(client::Config::default());
    let actual_fp = Arc::new(Mutex::new(None));
    let mismatch = Arc::new(Mutex::new(false));
    let client = Client {
        expected_fp,
        actual_fp: actual_fp.clone(),
        mismatch: mismatch.clone(),
    };

    let mut handle = match client::connect(config, (addr, port), client).await {
        Ok(h) => h,
        Err(e) => {
            if *mismatch.lock().unwrap() {
                return Err("主机公钥指纹已变更，可能存在中间人攻击风险，已拒绝连接".to_string());
            }
            return Err(e.to_string());
        }
    };

    let ok = match auth {
        Auth::Password(password) => handle
            .authenticate_password(username, password)
            .await
            .map_err(|e| e.to_string())?
            .success(),
        Auth::Key { path, passphrase } => {
            let key = load_secret_key(&path, passphrase.as_deref())
                .map_err(|e| format!("加载私钥失败（{path}）：{e}"))?;
            let key = Arc::new(key);
            // RSA 私钥需选哈希算法（多数服务器已拒绝 SHA-1 的 ssh-rsa）；
            // 非 RSA 时 PrivateKeyWithHashAlg 会忽略该参数。
            let hash = handle.best_supported_rsa_hash().await.ok().flatten().flatten();
            handle
                .authenticate_publickey(username, PrivateKeyWithHashAlg::new(key, hash))
                .await
                .map_err(|e| e.to_string())?
                .success()
        }
    };
    if !ok {
        return Err("认证失败：凭据被服务器拒绝（请检查用户名 / 密码 / 私钥）".to_string());
    }

    let fp = actual_fp.lock().unwrap().clone().unwrap_or_default();
    Ok((handle, fp))
}

/// 便捷包装：用密码连接（保留供集成测试与简单调用）。
#[allow(dead_code)]
pub async fn connect_password(
    addr: &str,
    port: u16,
    username: &str,
    password: &str,
    expected_fp: Option<String>,
) -> Result<(client::Handle<Client>, String), String> {
    connect(addr, port, username, Auth::Password(password.to_string()), expected_fp).await
}

/// 发给一个 PTY 会话任务的指令。
///
/// Task 11 的 SessionManager 会复用此枚举，通过 mpsc 向 run() 循环投递操作。
pub enum Cmd {
    /// 向 PTY 写入字节（如终端键盘输入）。
    Write(Vec<u8>),
    /// 调整窗口大小（列、行）。
    Resize(u32, u32),
    /// 主动关闭会话。
    Close,
}

/// 一个活跃的 PTY 会话：持有 channel，由 run() 单任务循环驱动读写。
///
/// 因为 russh 的 `Channel` 既要被 `wait()` 读取又要 `data()` 写入，
/// 无法 split，所以读写共用一个 channel，由 run() 用 `tokio::select!` 复用。
pub struct PtySession {
    channel: russh::Channel<client::Msg>,
}

impl PtySession {
    /// 在已认证连接上请求一个 PTY 并启动 shell。
    pub async fn open(
        handle: &client::Handle<Client>,
        cols: u32,
        rows: u32,
    ) -> Result<Self, russh::Error> {
        let channel = handle.channel_open_session().await?;
        // request_pty: want_reply=false, term, 列/行, 像素宽/高=0, terminal_modes=空。
        channel
            .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
            .await?;
        channel.request_shell(false).await?;
        Ok(PtySession { channel })
    }

    /// 单任务循环：同时处理远端输出与前端指令，读写共用一个 channel。
    ///
    /// - 远端输出（Data/ExtendedData）→ on_data 回调；
    /// - 前端指令（Write/Resize/Close）→ 操作 channel；
    /// - Eof/Close/通道结束/指令通道关闭 → 退出循环并触发 on_close。
    pub async fn run(
        mut self,
        mut cmd_rx: mpsc::UnboundedReceiver<Cmd>,
        on_data: impl Fn(Vec<u8>) + Send + 'static,
        on_close: impl Fn() + Send + 'static,
    ) {
        loop {
            tokio::select! {
                msg = self.channel.wait() => match msg {
                    Some(ChannelMsg::Data { data }) => on_data(data.to_vec()),
                    Some(ChannelMsg::ExtendedData { data, .. }) => on_data(data.to_vec()),
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                    _ => {}
                },
                cmd = cmd_rx.recv() => match cmd {
                    Some(Cmd::Write(d)) => { let _ = self.channel.data(&d[..]).await; }
                    Some(Cmd::Resize(c, r)) => { let _ = self.channel.window_change(c, r, 0, 0).await; }
                    Some(Cmd::Close) | None => break,
                }
            }
        }
        on_close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 集成测试：需要先运行 scripts/test-sshd.sh 起本地 sshd 容器。
    // 默认 #[ignore]，按需手动跑：
    //   cargo test ssh_session::tests::connects_with_password -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn connects_with_password() {
        let (h, fp) = connect_password("127.0.0.1", 2222, "tester", "testpass", None)
            .await
            .expect("应当通过密码认证");
        assert!(fp.starts_with("SHA256:"), "应拿到服务器指纹, got: {fp}");
        drop(h);
    }

    // 集成测试：错误密码应当返回 Err（不能把失败当成功）。
    #[tokio::test]
    #[ignore]
    async fn rejects_wrong_password() {
        let r = connect_password("127.0.0.1", 2222, "tester", "wrong-password", None).await;
        assert!(r.is_err(), "错误密码必须认证失败");
    }

    // 集成测试：已知指纹不匹配时必须拒绝连接（TOFU 防中间人）。
    #[tokio::test]
    #[ignore]
    async fn rejects_changed_fingerprint() {
        let r = connect_password(
            "127.0.0.1",
            2222,
            "tester",
            "testpass",
            Some("SHA256:bogusfingerprint".to_string()),
        )
        .await;
        assert!(r.is_err(), "指纹不匹配必须拒绝连接");
    }

    // 集成测试：开 PTY、写 echo 命令、确认在输出中收到回显结果。
    //   cargo test ssh_session::tests::pty_echoes_command_output -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn pty_echoes_command_output() {
        let (h, _fp) = connect_password("127.0.0.1", 2222, "tester", "testpass", None)
            .await
            .unwrap();
        let session = PtySession::open(&h, 80, 24).await.unwrap();

        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        tokio::spawn(session.run(
            cmd_rx,
            move |chunk| {
                let _ = out_tx.send(chunk);
            },
            || {},
        ));

        cmd_tx
            .send(Cmd::Write(b"echo hello_itest\n".to_vec()))
            .unwrap();

        let mut got = String::new();
        let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(5);
        while tokio::time::Instant::now() < deadline {
            match tokio::time::timeout(
                tokio::time::Duration::from_millis(500),
                out_rx.recv(),
            )
            .await
            {
                Ok(Some(chunk)) => {
                    got.push_str(&String::from_utf8_lossy(&chunk));
                    if got.contains("hello_itest") {
                        break;
                    }
                }
                _ => {}
            }
        }
        let _ = cmd_tx.send(Cmd::Close);
        assert!(
            got.contains("hello_itest"),
            "应在 PTY 输出中看到 echo 结果, got: {got}"
        );
    }
}

//! SSH 会话：基于 russh 实现建链 + 密码认证。
//!
//! 阶段一只做"连得上、密码认证通过"，主机密钥指纹校验留到后续阶段。
//! 注意：russh 0.61 的 API 与早期版本（0.45）差异较大，下方均按 0.61 实现。

use russh::client;
use russh::keys::ssh_key;
use russh::ChannelMsg;
use std::sync::Arc;
use tokio::sync::mpsc;

/// 客户端回调处理器。
///
/// russh 0.61 的 `client::Handler` 已经是原生 async trait（`impl Future` 形式），
/// 不再需要 `#[async_trait]` 宏。
pub struct Client;

impl client::Handler for Client {
    type Error = russh::Error;

    /// 阶段一：接受任意服务器公钥（指纹校验留到阶段二/三）。
    ///
    /// 0.61 中公钥类型为 `russh::keys::ssh_key::PublicKey`
    /// （早期版本是 `russh_keys::key::PublicKey`，russh-keys 现已并入 russh::keys）。
    async fn check_server_key(
        &mut self,
        _server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

/// 用密码建立一个已认证的 SSH 连接，返回可复用的会话句柄。
///
/// Task 10 将基于返回的 `client::Handle<Client>` 打开 PTY 通道。
pub async fn connect_password(
    addr: &str,
    port: u16,
    username: &str,
    password: &str,
) -> Result<client::Handle<Client>, russh::Error> {
    let config = Arc::new(client::Config::default());
    let mut handle = client::connect(config, (addr, port), Client).await?;

    // 0.61 的 authenticate_password 返回 Result<AuthResult, Error>，
    // 用 .success() 判断是否认证成功（早期版本直接返回 Result<bool>）。
    let auth = handle.authenticate_password(username, password).await?;
    if !auth.success() {
        return Err(russh::Error::NotAuthenticated);
    }
    Ok(handle)
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
        let h = connect_password("127.0.0.1", 2222, "tester", "testpass")
            .await
            .expect("应当通过密码认证");
        drop(h);
    }

    // 集成测试：错误密码应当返回 Err（不能把失败当成功）。
    #[tokio::test]
    #[ignore]
    async fn rejects_wrong_password() {
        let r = connect_password("127.0.0.1", 2222, "tester", "wrong-password").await;
        assert!(r.is_err(), "错误密码必须认证失败");
    }

    // 集成测试：开 PTY、写 echo 命令、确认在输出中收到回显结果。
    //   cargo test ssh_session::tests::pty_echoes_command_output -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn pty_echoes_command_output() {
        let h = connect_password("127.0.0.1", 2222, "tester", "testpass")
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

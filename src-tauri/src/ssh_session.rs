//! SSH 会话：基于 russh 实现建链 + 密码认证。
//!
//! 阶段一只做"连得上、密码认证通过"，主机密钥指纹校验留到后续阶段。
//! 注意：russh 0.61 的 API 与早期版本（0.45）差异较大，下方均按 0.61 实现。

use russh::client;
use russh::keys::ssh_key;
use std::sync::Arc;

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
}

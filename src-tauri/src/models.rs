use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    pub id: String,
    pub name: String,
    pub address: String,
    pub port: u16,
    pub username: String,
    pub group_id: Option<String>,
    pub tags: Vec<String>,
    pub auth_type: String,          // "password" | "key"
    pub credential_ref: Option<String>, // 钥匙串账户名（密码 / 密钥口令）= host.id
    pub proxy_jump: Option<String>,
    pub key_path: Option<String>,   // auth_type=="key" 时的私钥文件路径
    pub use_tmux: bool,             // 连接时用 tmux 包裹，断线重连可恢复会话
    pub tmux_session: Option<String>, // tmux 会话名（空则用默认 "main"）
}

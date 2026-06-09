# SSH 客户端设计文档

- 日期：2026-06-09
- 状态：已批准设计，待编写实现计划

## 一、目标与定位

构建一个**快速、方便管理**的桌面 SSH 客户端，面向**中等规模（10~100 台服务器）**的个人/小团队使用场景。核心价值是两点：

1. **快速**：启动快、内存占用低、键盘优先、一键连接。
2. **方便管理**：分组 + 标签组织主机，快速搜索/命令面板检索。

## 二、技术选型

| 层 | 选型 | 理由 |
|----|------|------|
| 应用框架 | **Tauri** (Rust + 系统 WebView) | 启动快、内存低、安装包小，最契合"快速"诉求 |
| 前端 | **React + xterm.js** | 生态成熟、组件丰富；xterm.js 是终端渲染事实标准 |
| 后端 SSH | **russh + russh-sftp**（纯 Rust） | 完整掌控 PTY/SFTP/端口转发，跨平台行为一致，异步高性能 |
| 配置存储 | **SQLite**（rusqlite / tauri-plugin-sql） | 中等规模足够，支持快速搜索过滤 |
| 凭据存储 | **keyring** crate → Windows Credential Manager | 敏感凭据不落数据库明文 |
| 前端状态 | zustand | 轻量 |

**目标平台**：第一版**主要面向 Windows**（在 Linux 上日常开发）。架构上做跨平台抽象，后续可扩展 macOS/Linux 发行版。

## 三、总体架构

```
┌─────────────────────────────────────────────┐
│  前端 (React + xterm.js, 跑在 WebView2)        │
│  - 连接列表/分组侧边栏                          │
│  - 命令面板（快速搜索 + 一键连接）              │
│  - 多标签终端区 (xterm.js)                     │
│  - SFTP 文件面板                               │
└───────────────┬─────────────────────────────┘
                │  Tauri IPC (命令调用 + 事件流)
┌───────────────┴─────────────────────────────┐
│  后端 (Rust)                                  │
│  - connection_store  连接配置 CRUD            │
│  - credential_vault  凭据存取(系统钥匙串)      │
│  - ssh_session       russh 会话 + PTY 通道     │
│  - sftp_service      russh-sftp 文件传输       │
│  - ssh_config_import 解析 ~/.ssh/config       │
└──────────────────────────────────────────────┘
```

**关键边界**：前端只负责展示和交互，**绝不接触明文凭据**；所有 SSH/PTY/SFTP/密钥操作都在 Rust 后端完成。前端通过 Tauri 的 `invoke` 调用后端命令，终端字节流和连接状态变化通过 Tauri **事件**推送给前端。

## 四、数据模型

连接配置（非敏感）存 SQLite，**敏感凭据单独存系统钥匙串**，两者用 `credential_ref` 关联。

```
Host {
  id, name, address, port, username,
  group_id,            // 所属分组
  tags: [string],      // 标签，用于搜索过滤
  auth_type,           // password | key | agent
  credential_ref,      // 指向钥匙串里的条目，不存明文
  proxy_jump,          // 从 ssh config 解析来的字段，MVP 仅存不主动用
  created_at, updated_at
}

Group {
  id, name, parent_id  // 支持嵌套文件夹
}
```

- **凭据存储**：明文密码、私钥 passphrase 放钥匙串，数据库只存 `credential_ref`。
- **私钥**：MVP 支持"引用磁盘上的私钥路径" + passphrase 存钥匙串。后续可支持导入托管。

## 五、功能模块（MVP 范围）

MVP = **核心四件套 + 导入 ssh config + SFTP**。

1. **连接管理 + 分组/标签**
   - 侧边栏树形展示嵌套分组 + 主机；主机可打多个标签。
   - 增删改走后端 `connection_store`，写 SQLite。标签与分组均参与搜索过滤。

2. **快速搜索 / 命令面板**
   - 全局快捷键 `Ctrl+K` 唤起命令面板，模糊匹配主机名/地址/标签。
   - 前端内存模糊匹配（数据量小），回车一键连接，全程键盘可操作。

3. **多标签终端**
   - 每个连接 = 一个后端 `ssh_session`（唯一 `session_id`，独立 PTY 通道）+ 一个前端 xterm.js 标签页。
   - 会话互相独立，关闭标签即关闭会话。

4. **凭据管理**
   - 新建/编辑时输入的密码/passphrase 立即交后端存入钥匙串，前端不留存、不回显明文。
   - 连接时后端按 `credential_ref` 取凭据注入 russh 认证。

5. **导入 ~/.ssh/config**
   - 解析 Host/HostName/Port/User/IdentityFile/ProxyJump，生成 Host 记录（默认归入"导入"分组）。
   - ProxyJump 仅解析存下，MVP 不主动建链。

6. **SFTP 文件传输**
   - 在已连接会话上开 SFTP 面板（同一连接的新通道，`russh-sftp`）。
   - 浏览远端目录、上传/下载，进度通过事件推送。

### 后续版本（非 MVP）

- 主动的跳板机 / ProxyJump 连接
- 自动重连
- 配置同步、批量操作
- 端口转发 UI
- macOS / Linux 发行版

## 六、关键数据流：发起一次连接

```
用户在命令面板回车
  → 前端 invoke("connect", {host_id})
  → 后端 connection_store 读配置
  → credential_vault 从钥匙串取凭据
  → ssh_session 用 russh 建链 + 认证 + 开 PTY
  → 返回 session_id 给前端
  → 前端创建 xterm 标签页，订阅该 session 的事件

之后双向流：
  键盘输入 → invoke("write", {session_id, data}) → russh PTY
  远端输出 → 后端 emit("ssh://{session_id}/data", bytes) → xterm 渲染
  窗口缩放 → invoke("resize", {session_id, cols, rows}) → PTY resize
```

## 七、错误处理

- **连接层**：DNS 失败、超时、认证失败、Host key 变更——后端返回结构化错误码，前端在标签页内显示明确原因。Host key 首次连接需用户确认并记录指纹。
- **会话中断**：网络断开后后端发 `ssh://{session_id}/closed` 事件，前端标记"已断开"并提供"重连"按钮（MVP 手动重连，自动重连后置）。
- **凭据缺失/钥匙串拒绝**：提示重新输入凭据。
- **IPC 边界**：所有后端命令返回 `Result`，错误统一序列化为前端可读结构。

## 八、前端界面布局

```
┌──────────┬──────────────────────────────────────┐
│ 侧边栏    │  [标签1] [标签2] [标签3] [+]           │
│          ├──────────────────────────────────────┤
│ 🔍搜索框  │                                       │
│          │                                       │
│ ▾ 生产组  │        xterm.js 终端区                 │
│   server1│                                       │
│   server2│                                       │
│ ▾ 测试组  │                                       │
│   db-1   │                                       │
│ ▾ 导入    ├──────────────────────────────────────┤
│   ...    │  (可选) SFTP 文件面板 / 状态栏          │
└──────────┴──────────────────────────────────────┘

      Ctrl+K → 命令面板浮层（模糊搜索 + 一键连接）
```

左侧搜索框 + 分组树；右侧标签栏 + 终端区；SFTP 面板在底部/抽屉弹出。整体键盘优先、简洁紧凑。

## 九、项目结构

```
ssh_client/
├── src/                    # React 前端
│   ├── components/         # Sidebar, CommandPalette, TerminalTab, SftpPanel
│   ├── stores/            # 连接列表、会话状态 (zustand)
│   ├── ipc/               # 封装 Tauri invoke/event 调用
│   └── App.tsx
├── src-tauri/             # Rust 后端
│   ├── src/
│   │   ├── connection_store.rs
│   │   ├── credential_vault.rs
│   │   ├── ssh_session.rs
│   │   ├── sftp_service.rs
│   │   ├── ssh_config_import.rs
│   │   └── commands.rs    # Tauri 命令入口
│   └── tauri.conf.json
└── docs/superpowers/specs/
```

每个 Rust 模块单一职责、可独立测试；前端 `ipc/` 层把后端调用收拢到一处，便于 mock 和替换。

## 十、测试策略

- **Rust 单元测试**：`ssh_config_import`（纯解析逻辑）、`connection_store`（临时 SQLite 上的 CRUD）、`credential_vault`（mock keyring）。
- **SSH 集成测试**：用 Docker（如 `linuxserver/openssh-server`）起本地 SSH 服务，跑真实连接/认证/PTY/SFTP 往返。
- **前端**：Vitest + Testing Library，覆盖命令面板模糊匹配、标签管理。
- **跨平台风险点**：日常在 Linux 开发，但 **Windows Credential Manager 和 ConPTY 必须在 Windows 实机/CI 上验证**——这两块在 Linux 上测不到。

## 十一、MVP 里程碑（建议顺序）

1. **骨架**：Tauri + React 跑起来，IPC 通路打通。
2. **连接管理**：SQLite + CRUD + 分组/标签侧边栏。
3. **单会话终端**：russh 建链 + PTY + xterm 双向流（先密码认证）。
4. **凭据钥匙串**：接入 keyring，密码/passphrase 安全存储。
5. **多标签 + 命令面板**：多会话并发 + Ctrl+K 快速连接。
6. **导入 ssh config**：解析并导入主机。
7. **SFTP**：文件浏览 + 上传下载。
8. **Windows 打包验证**：Windows 上完整跑一遍核心流程。

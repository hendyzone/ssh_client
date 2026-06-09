# SSH 客户端 — 阶段三（主机指纹校验 + 重连）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 TOFU（首次信任）方式校验 SSH 主机公钥指纹——首次连接记录指纹，再次连接校验，指纹变更则在发送密码前拒绝并告警（防中间人）；并为断开的会话提供一键重连。

**Architecture:** 后端 `known_hosts` 表存 `host(address:port) → fingerprint`；`Client` 持有连接前查出的 `expected_fp` 与回传实际指纹的共享 cell + `mismatch` 标志，`check_server_key` 计算服务器公钥指纹比对，不符返回 `Ok(false)`（russh 在认证前断开，密码不外泄）；`connect_password` 返回 `(handle, actual_fp)`，`connect_cmd` 同步段读已知指纹、await 连接、首次则记录指纹（DB 访问不跨 await）。前端 `TerminalView` 在 `onClosed` 后展示"重连"覆盖层，点击复用同 sessionId/hostId 重新连接。

**Tech Stack:** russh 0.61（`ssh_key::PublicKey::fingerprint`）、rusqlite、Tauri、React + TS。

**前置现状（Part 2 末态）：** `ssh_session.rs`：`Client`（空 struct，`check_server_key` 无条件 `Ok(true)`）、`connect_password(addr,port,username,password) -> Result<Handle<Client>, russh::Error>`、`PtySession::open/run`、`Cmd`；`session_manager.rs`：`SessionManager` + `spawn_session(addr,port,username,password,cols,rows,on_data,on_close) -> Result<UnboundedSender<Cmd>, String>`；`commands.rs`：`connect_cmd(app, db, sessions, session_id, host_id, cols, rows)` 同步段取 host+密码、await spawn_session；`db.rs::init_schema` 有 groups/hosts 表 + 外键 PRAGMA；`connection_store` 有 get_host 等；前端 `TerminalView({sessionId, hostId})` 在 onClosed 时写 `[已断开]`。

---

## 文件结构

**后端 `src-tauri/src/`**
- `db.rs` — 修改。`init_schema` 加 `known_hosts(host TEXT PRIMARY KEY, fingerprint TEXT NOT NULL)` 表。
- `connection_store.rs` — 修改。`get_known_fingerprint(conn, host) -> Option<String>`、`set_known_fingerprint(conn, host, fp)` + 测试。
- `ssh_session.rs` — 修改。`Client` 加字段与指纹校验；`connect_password` 加 `expected_fp` 参数、返回 `(handle, actual_fp)`、错误类型改 `String`；更新其集成测试。
- `session_manager.rs` — 修改。`spawn_session` 加 `expected_fp` 参数、返回 `(UnboundedSender<Cmd>, String)`（含实际指纹）。
- `commands.rs` — 修改。`connect_cmd` 读已知指纹、await、首次记录指纹、指纹变更返回明确错误。

**前端 `src/`**
- `components/TerminalView.tsx` — 修改。断开后展示"重连"覆盖层，点击重连（复用 sessionId/hostId）。

---

## 里程碑 A：known_hosts 指纹校验（TOFU）

### Task 1: known_hosts 表 + 存取函数

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/connection_store.rs`

- [ ] **Step 1: 加 known_hosts 表**

In `src-tauri/src/db.rs` 的 `init_schema`，在 `execute_batch` 的建表 SQL 里追加一张表（与 groups/hosts 并列）：
```sql
        CREATE TABLE IF NOT EXISTS known_hosts (
            host TEXT PRIMARY KEY,
            fingerprint TEXT NOT NULL
        );
```

- [ ] **Step 2: 写存取函数 + 测试**

在 `src-tauri/src/connection_store.rs` 的 `#[cfg(test)]` 之前追加：
```rust
/// 读取某主机（"address:port"）已记录的公钥指纹。
pub fn get_known_fingerprint(conn: &Connection, host: &str) -> rusqlite::Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT fingerprint FROM known_hosts WHERE host = ?1")?;
    let mut rows = stmt.query_map(rusqlite::params![host], |r| r.get::<_, String>(0))?;
    match rows.next() {
        Some(fp) => Ok(Some(fp?)),
        None => Ok(None),
    }
}

/// 记录/更新某主机的公钥指纹（TOFU 首次写入；变更确认后由上层决定是否覆盖）。
pub fn set_known_fingerprint(conn: &Connection, host: &str, fingerprint: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO known_hosts (host, fingerprint) VALUES (?1, ?2)
         ON CONFLICT(host) DO UPDATE SET fingerprint = ?2",
        rusqlite::params![host, fingerprint],
    )?;
    Ok(())
}
```
在 `mod tests` 内追加：
```rust
    #[test]
    fn known_fingerprint_roundtrip() {
        let c = mem();
        assert_eq!(get_known_fingerprint(&c, "1.2.3.4:22").unwrap(), None);
        set_known_fingerprint(&c, "1.2.3.4:22", "SHA256:abc").unwrap();
        assert_eq!(get_known_fingerprint(&c, "1.2.3.4:22").unwrap(), Some("SHA256:abc".to_string()));
        // 覆盖更新
        set_known_fingerprint(&c, "1.2.3.4:22", "SHA256:def").unwrap();
        assert_eq!(get_known_fingerprint(&c, "1.2.3.4:22").unwrap(), Some("SHA256:def".to_string()));
    }
```

- [ ] **Step 3: 跑测试**

Run:
```bash
cd src-tauri && cargo test connection_store:: 2>&1 | tail -15
```
Expected: `known_fingerprint_roundtrip` 通过，且原有 connection_store 测试不回归。

- [ ] **Step 4: Commit**
```bash
git add -A
git commit -m "feat: known_hosts 表与指纹存取函数"
```

---

### Task 2: Client 指纹校验 + connect_password 改造

**Files:**
- Modify: `src-tauri/src/ssh_session.rs`

> **russh 0.61 指纹 API 提醒**：服务器公钥类型是 `russh::keys::ssh_key::PublicKey`。计算指纹用 `key.fingerprint(HashAlg::Sha256)`，返回 `ssh_key::Fingerprint`，其 `to_string()` 形如 `"SHA256:base64..."`。`HashAlg` 在 `ssh_key` 里（`russh::keys::ssh_key::HashAlg` 或 `ssh_key::HashAlg`）。**以实际编译为准核对 `HashAlg` 路径与 `fingerprint` 方法签名**；若 API 不符，查 ssh_key crate 文档调整（目标：拿到该公钥的 SHA256 指纹字符串）。

- [ ] **Step 1: 改 Client 结构与 check_server_key**

把 `ssh_session.rs` 的 `Client` 定义与其 `Handler` impl 替换为：
```rust
use std::sync::Mutex;

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
```
（注意：文件顶部已 `use std::sync::Arc;`；新增 `use std::sync::Mutex;`，与现有 import 合并，勿重复。）

- [ ] **Step 2: 改 connect_password 签名与实现**

把 `connect_password` 替换为：
```rust
/// 用密码建立已认证的 SSH 连接，附带 TOFU 指纹校验。
///
/// `expected_fp`：known_hosts 中该主机的已知指纹；None 表示首次连接。
/// 返回 `(已认证句柄, 服务器实际公钥指纹)`；指纹变更时返回语义化错误。
pub async fn connect_password(
    addr: &str,
    port: u16,
    username: &str,
    password: &str,
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

    let auth = handle
        .authenticate_password(username, password)
        .await
        .map_err(|e| e.to_string())?;
    if !auth.success() {
        return Err("认证失败：用户名或密码错误".to_string());
    }

    let fp = actual_fp.lock().unwrap().clone().unwrap_or_default();
    Ok((handle, fp))
}
```

- [ ] **Step 3: 更新 ssh_session 内的集成测试以匹配新签名**

`ssh_session.rs` 的 `mod tests` 里三个集成测试调用了 `connect_password`，需更新为新签名（加 `None` 期望指纹、解构 tuple）：
- `connects_with_password`：
```rust
    #[tokio::test]
    #[ignore]
    async fn connects_with_password() {
        let (h, fp) = connect_password("127.0.0.1", 2222, "tester", "testpass", None)
            .await
            .expect("应当通过密码认证");
        assert!(fp.starts_with("SHA256:"), "应拿到服务器指纹, got: {fp}");
        drop(h);
    }
```
- `rejects_wrong_password`：
```rust
    #[tokio::test]
    #[ignore]
    async fn rejects_wrong_password() {
        let r = connect_password("127.0.0.1", 2222, "tester", "wrong-password", None).await;
        assert!(r.is_err(), "错误密码必须认证失败");
    }
```
- `pty_echoes_command_output`：把 `let h = connect_password(...).await.unwrap();` 改为 `let (h, _fp) = connect_password("127.0.0.1", 2222, "tester", "testpass", None).await.unwrap();`（其余不变）。
- 新增一个指纹变更被拒的集成测试：
```rust
    #[tokio::test]
    #[ignore]
    async fn rejects_changed_fingerprint() {
        // 传一个与真实服务器不符的期望指纹 → 应被拒绝
        let r = connect_password("127.0.0.1", 2222, "tester", "testpass", Some("SHA256:bogusfingerprint".to_string())).await;
        assert!(r.is_err(), "指纹不匹配必须拒绝连接");
    }
```

- [ ] **Step 4: 编译 + 跑集成测试**

先确保容器在跑（`./scripts/test-sshd.sh`），然后：
```bash
cd src-tauri && cargo build 2>&1 | tail -15
cd src-tauri && cargo test ssh_session:: -- --ignored --nocapture 2>&1 | tail -20
```
Expected: 编译无 error（注意 connect_password 现返回 `Result<(...), String>`，session_manager 在 Task 3 同步改——本步 `cargo build` 可能因 session_manager 旧调用报错，属预期，会在 Task 3 修；若想本步先过编译，可仅 `cargo build -p` 或接受报错并在 Task 3 一并验证。**实际操作：本步先只跑 `cargo build` 看 ssh_session 自身语法，session_manager 的类型错误留到 Task 3**）。集成测试在 Task 3 完成后统一跑更稳。
> 调整：本 Task 只改 ssh_session.rs。由于 session_manager 调用了旧签名 connect_password，整体 `cargo build` 会报 session_manager 的错——这是预期的跨任务依赖。本步确认 ssh_session.rs **自身**无语法/类型错误（可用 `cargo build 2>&1 | grep ssh_session` 看是否有 ssh_session 内部错误），集成测试与整体编译在 Task 3 后跑。

- [ ] **Step 5: Commit**
```bash
git add src-tauri/src/ssh_session.rs
git commit -m "feat: Client TOFU 指纹校验，connect_password 返回实际指纹"
```

---

### Task 3: spawn_session 传递指纹

**Files:**
- Modify: `src-tauri/src/session_manager.rs`

- [ ] **Step 1: 改 spawn_session 签名与实现**

In `src-tauri/src/session_manager.rs`，把 `spawn_session` 改为接收 `expected_fp`、返回 `(发送端, 实际指纹)`：
```rust
/// 建链（带 TOFU 指纹校验）、开 PTY，启动读写循环。
/// 返回 (会话指令发送端, 服务器实际公钥指纹)。
pub async fn spawn_session(
    addr: String,
    port: u16,
    username: String,
    password: String,
    expected_fp: Option<String>,
    cols: u32,
    rows: u32,
    on_data: impl Fn(Vec<u8>) + Send + 'static,
    on_close: impl Fn() + Send + 'static,
) -> Result<(mpsc::UnboundedSender<Cmd>, String), String> {
    let (handle, fp) = connect_password(&addr, port, &username, &password, expected_fp).await?;
    let session = PtySession::open(&handle, cols, rows)
        .await
        .map_err(|e| e.to_string())?;
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<Cmd>();
    tokio::spawn(session.run(cmd_rx, on_data, on_close));
    Ok((cmd_tx, fp))
}
```
（`connect_password` 现返回 `Result<(Handle, String), String>`，`?` 直接传播 String 错误；`PtySession::open` 仍返回 `russh::Error`，用 `.map_err(|e| e.to_string())`。）

- [ ] **Step 2: 编译确认 ssh_session + session_manager 一致**

Run:
```bash
cd src-tauri && cargo build 2>&1 | tail -15
```
Expected: ssh_session 与 session_manager 编译通过；commands.rs 的 connect_cmd 仍用旧 spawn_session 调用 → 报错（Task 4 修），属预期。可 `cargo build 2>&1 | grep -E "session_manager|ssh_session"` 确认这两个文件自身无错。

- [ ] **Step 3: Commit**
```bash
git add src-tauri/src/session_manager.rs
git commit -m "feat: spawn_session 传入期望指纹并返回实际指纹"
```

---

### Task 4: connect_cmd 接入指纹校验与记录

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: 改 connect_cmd**

把 `commands.rs` 的 `connect_cmd` 替换为（在同步段读已知指纹，await 连接，首次则记录）：
```rust
#[tauri::command]
pub async fn connect_cmd(
    app: AppHandle,
    db: State<'_, Db>,
    sessions: State<'_, SessionManager>,
    session_id: String,
    host_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    // —— 同步段：取 host + 密码 + 已知指纹，随即释放锁 ——
    let (address, port, username, password, host_key, expected_fp) = {
        let c = db.0.lock().map_err(map_err)?;
        let host = cs::get_host(&c, &host_id)
            .map_err(map_err)?
            .ok_or_else(|| "主机不存在".to_string())?;
        let password = match host.credential_ref.as_deref() {
            Some(r) => credential_vault::get(r)?
                .ok_or_else(|| "未找到该主机的已保存凭据，请先在主机编辑里填写密码".to_string())?,
            None => return Err("该主机未配置密码凭据，请先编辑主机填写密码".to_string()),
        };
        let host_key = format!("{}:{}", host.address, host.port);
        let expected_fp = cs::get_known_fingerprint(&c, &host_key).map_err(map_err)?;
        drop(c);
        (host.address, host.port, host.username, password, host_key, expected_fp)
    };

    let is_first = expected_fp.is_none();

    // —— 异步段：建链（含指纹校验）——
    let app_data = app.clone();
    let sid_data = session_id.clone();
    let app_close = app.clone();
    let sid_close = session_id.clone();

    let (tx, actual_fp) = spawn_session(
        address, port, username, password, expected_fp, cols, rows,
        move |chunk| {
            let _ = app_data.emit(&format!("ssh://{sid_data}/data"), chunk);
        },
        move || {
            let _ = app_close.emit(&format!("ssh://{sid_close}/closed"), ());
        },
    )
    .await?;

    // —— 首次连接：记录指纹（TOFU）——
    if is_first {
        let c = db.0.lock().map_err(map_err)?;
        cs::set_known_fingerprint(&c, &host_key, &actual_fp).map_err(map_err)?;
    }

    sessions.register(session_id, tx);
    Ok(())
}
```
（`spawn_session` 现返回 `(tx, actual_fp)`；记录指纹的 DB lock 在 await 之后、不跨 await。`map_err` 已有。）

- [ ] **Step 2: 编译 + 全量后端测试 + 指纹集成测试**

先确保容器在跑，然后：
```bash
cd src-tauri && cargo build 2>&1 | tail -15
cd src-tauri && cargo test --lib 2>&1 | grep "test result"
cd src-tauri && cargo test ssh_session:: connection_store::tests::known_fingerprint_roundtrip -- --ignored --nocapture 2>&1 | tail -20
```
Expected: 整体编译通过；单元测试全过（含 known_fingerprint_roundtrip）；ssh_session 四个集成测试（含 connects_with_password 拿到 SHA256 指纹、rejects_changed_fingerprint 被拒）通过。

- [ ] **Step 3: Commit**
```bash
git add src-tauri/src/commands.rs
git commit -m "feat: connect 接入 TOFU 指纹校验，首次连接记录指纹"
```

---

## 里程碑 B：手动重连

### Task 5: TerminalView 断开后重连

**Files:**
- Modify: `src/components/TerminalView.tsx`

- [ ] **Step 1: 改 TerminalView 支持重连**

把 `src/components/TerminalView.tsx` 替换为（断开后显示重连覆盖层，点击复用 sessionId/hostId 重新连接）：
```tsx
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { session } from "../ipc";

/** xterm 终端视图，接入后端 SSH 会话的双向数据流；断开后可一键重连。 */
export function TerminalView({
  sessionId,
  hostId,
}: {
  sessionId: string;
  hostId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // 每次 +1 触发 effect 重跑以重连
  const [attempt, setAttempt] = useState(0);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    setClosed(false);
    const term = new Terminal({ fontSize: 14, convertEol: false });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    fit.fit();

    const encoder = new TextEncoder();
    const unlisteners: Promise<() => void>[] = [];

    (async () => {
      unlisteners.push(session.onData(sessionId, (bytes) => term.write(bytes)));
      unlisteners.push(
        session.onClosed(sessionId, () => {
          term.write("\r\n[已断开]\r\n");
          setClosed(true);
        }),
      );
      try {
        await session.connect({ sessionId, hostId, cols: term.cols, rows: term.rows });
      } catch (e) {
        term.write(`\r\n[连接失败] ${e}\r\n`);
        setClosed(true);
      }
    })();

    const onData = term.onData((d) => {
      session.write(sessionId, Array.from(encoder.encode(d)));
    });

    const onResize = () => {
      fit.fit();
      session.resize(sessionId, term.cols, term.rows);
    };
    const ro = new ResizeObserver(() => onResize());
    ro.observe(ref.current);

    return () => {
      ro.disconnect();
      onData.dispose();
      unlisteners.forEach((p) => p.then((u) => u()));
      session.close(sessionId);
      term.dispose();
    };
  }, [sessionId, hostId, attempt]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={ref} style={{ width: "100%", height: "100%" }} />
      {closed && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)" }}>
          <button onClick={() => setAttempt((n) => n + 1)} style={{ padding: "8px 16px" }}>
            重新连接
          </button>
        </div>
      )}
    </div>
  );
}
```
> 重连机制：点击按钮 `setAttempt(n+1)` → effect 依赖 `attempt` 变化 → cleanup（关旧会话/销毁旧 term）+ 重新初始化 term 并 `session.connect` 同 sessionId/hostId。后端 connect_cmd 用同 sessionId 重新建会话、注册（旧的已被 cleanup 的 session.close 移除）。

- [ ] **Step 2: 验证类型 + 测试 + 构建**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -5
npx vitest run 2>&1 | tail -8
npm run build 2>&1 | tail -6
```
Expected: tsc 无错；vitest 全过（17 个，TerminalView 无单测不受影响）；build 成功。

- [ ] **Step 3: Commit**
```bash
git add src/components/TerminalView.tsx
git commit -m "feat: 终端断开后支持一键重连"
```

---

### Task 6: 端到端验证 + 回归

**Files:** 无（验证任务）

- [ ] **Step 1: 后端全量 + 指纹集成测试**

确保容器在跑（`./scripts/test-sshd.sh`），然后：
```bash
cd src-tauri && cargo test --lib 2>&1 | grep "test result"
cd src-tauri && cargo test -- --ignored --nocapture 2>&1 | tail -20
```
Expected: 单元测试全过（含 known_fingerprint_roundtrip）；集成测试全过——`connects_with_password`（拿到 SHA256 指纹）、`rejects_wrong_password`、`rejects_changed_fingerprint`（指纹不符被拒）、`pty_echoes_command_output`、`manager_spawns_and_echoes`。

- [ ] **Step 2: 前端测试 + 类型 + 构建 + 整体编译**

Run:
```bash
cd /home/deng/workspace/ssh_client
npx vitest run 2>&1 | tail -8
npx tsc --noEmit 2>&1 | tail -5
npm run tauri build -- --no-bundle 2>&1 | tail -12
```
Expected: 前端全过；tsc 无错；整体编译通过。

- [ ] **Step 3: GUI 手动验证清单（留待有显示器环境）**

需测试容器。`npm run tauri dev` 后：
1. **首次连接**：连接主机（127.0.0.1:2222）→ 正常连上（TOFU 记录指纹，静默）。
2. **再次连接同主机**：再连 → 仍正常（指纹匹配）。
3. **指纹变更模拟**：`docker rm -f ssh-itest && ./scripts/test-sshd.sh`（重建容器 → 主机密钥变化），再连同主机 → **连接被拒，提示"主机公钥指纹已变更…"**（不发送密码）。验证后可手动清除该 host 的 known_hosts 记录（或换 host:port）再连。
4. **重连**：连上后 `docker restart ssh-itest` 使会话断开 → 终端显示 `[已断开]` + "重新连接"按钮；点击 → 重新连上、终端可用。

- [ ] **Step 4: 完成报告**

汇总自动化结果，列出 Step 3 人工清单交付。

---

## 阶段三完成标准（Definition of Done）

- 首次连接 TOFU 记录主机公钥指纹；再次连接校验；指纹变更在发送密码前拒绝并给出明确告警。
- known_hosts 指纹存取有单元测试；指纹校验有集成测试（拿到指纹、变更被拒）。
- 断开的会话可一键重连，复用同标签。
- 后端单元 + 集成测试、前端测试、tsc、`tauri build --no-bundle` 全绿。

## 后续（不在本计划内）

- **正式包名**：`ssh-client-scaffold` → 用户指定正式名（Cargo.toml `name`/`[lib] name`、`tauri.conf.json` `productName`/`identifier`、`build-windows.sh` 产物路径）。**务必保持 `credential_vault::SERVICE = "ssh-client"` 不变**（否则已存凭据读不到）。需用户先定名字。
- **指纹变更的 GUI 处理**：当前变更即拒绝，用户需手动清 known_hosts 记录。后续可加"指纹变更确认/更新"对话框。
- **自动重连**：当前为手动按钮，后续可加断线后自动重试 N 次。
- **首次连接指纹确认**：当前首次静默 TOFU，后续可加首次弹窗展示指纹供用户确认。
- **Part 1/2 遗留 Minor**：凭据/库写入非原子；auth_type 前端硬编码；删组/删主机无确认 UI；命令面板方向键导航；display:none 下 fit 零尺寸守卫；补若干测试缺口。

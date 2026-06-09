# SSH 客户端 — 阶段二 Part 1（凭据安全 + 主机管理）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用系统钥匙串安全存储 SSH 凭据（消除阶段一前端 `window.prompt` 的明文密码），并提供 GUI 主机新增/编辑/删除表单（脱离 devtools），连接时由后端按 host 从钥匙串取密码、前端不再接触明文。

**Architecture:** 后端新增 `credential_vault`（keyring 封装）；`save_host` 命令在 upsert 主机的同时把密码写入钥匙串并设 `credential_ref`；`connect` 命令改为按 `host_id` 在后端读库 + 取钥匙串密码（在 await 前同步完成、释放锁，避免 rusqlite 非 Send 跨 await）；前端新增 `HostForm` 组件，Sidebar 提供增删改入口，App 不再用 `window.prompt`。

**Tech Stack:** keyring 3.x（Windows Credential Manager / 测试用 mock）、rusqlite、Tauri 2.x、React + TS、zustand。

**前置现状（阶段一末态）：** `connect_cmd(session_id,address,port,username,password,cols,rows)` 收明文密码；`commands.rs` 有 group/host CRUD 命令；`connection_store` 的 `delete_group` 是无级联 DELETE；`db.rs::init_schema` 无外键；前端 `ipc/index.ts` 有 `api`（含 upsertHost/deleteHost）和 `session`（connect 传 password）；`Sidebar.tsx` 只有"+ 新分组"按钮和只读主机列表；`App.tsx` 用 `window.prompt` 取密码。

---

## 文件结构

**后端 `src-tauri/src/`**
- `credential_vault.rs` — 新建。钥匙串封装：`store/get/delete`，service 名固定 `"ssh-client"`，account 用 host id。纯函数模块，测试用 keyring mock。
- `connection_store.rs` — 修改。`delete_group` 级联把子主机 `group_id` 置空（配合 schema 外键）。
- `db.rs` — 修改。`hosts.group_id` 加 `REFERENCES groups(id) ON DELETE SET NULL`，并开启外键 PRAGMA。
- `commands.rs` — 修改。新增 `save_host_cmd`（upsert + 存凭据 + 设 credential_ref）；改 `delete_host_cmd`（删库前删凭据）；重构 `connect_cmd`（按 host_id 取钥匙串密码）。
- `lib.rs` — 修改。开启 SQLite 外键 PRAGMA；注册 `save_host_cmd`。

**前端 `src/`**
- `ipc/index.ts` — 修改。`api.saveHost(host, password)`；`session.connect` 改签名（去 password，传 hostId）。
- `stores/connections.ts` — 修改。`saveHost(host, password)`；新增 `removeGroup(id)`。
- `components/HostForm.tsx` — 新建。新增/编辑主机表单。
- `components/HostForm.test.tsx` — 新建。表单行为测试。
- `components/Sidebar.tsx` — 修改。每个主机加编辑/删除入口，分组加删除入口，顶部加"+ 主机"。
- `components/Sidebar.test.tsx` — 修改。覆盖新增交互。
- `App.tsx` — 修改。表单弹窗状态；连接改为传 hostId（不再 `window.prompt`）；无凭据时提示去编辑主机。

---

## 里程碑 A：后端凭据与数据完整性

### Task 1: keyring 依赖 + credential_vault 模块

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/credential_vault.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 加 keyring 依赖**

In `src-tauri/Cargo.toml` `[dependencies]` 追加：
```toml
keyring = { version = "3", features = ["windows-native", "apple-native"] }
```
> 说明：只启用 Windows（Credential Manager）和 macOS 原生后端——它们仅在对应目标编译时生效。**故意不启用 Linux 的 secret-service**：本机是 headless 开发/交叉编译环境，启用它会平白引入 dbus/secret-service 依赖，而我们在 Linux 上只跑 mock 测试、真实钥匙串读写发生在交叉编译出的 Windows 目标。生产代码若在 Linux 原生运行会因无后端报错——这超出当前目标（主攻 Windows），后续要支持 Linux 运行时再加 `sync-secret-service` 后端。keyring 的 `mock` 模块默认可用，无需 feature。

- [ ] **Step 2: 写 credential_vault（含 mock 单元测试）**

Create `src-tauri/src/credential_vault.rs`:
```rust
//! 系统钥匙串封装。明文凭据只存系统钥匙串，数据库仅存 credential_ref（= host id）。
//!
//! 单元测试用 keyring 的 mock 后端（headless Linux 无 secret-service）。
//! 真实后端（Windows Credential Manager）在目标平台手动验证。

const SERVICE: &str = "ssh-client";

/// 存储某 reference（一般是 host id）对应的密码。
pub fn store(reference: &str, secret: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, reference).map_err(|e| e.to_string())?;
    entry.set_password(secret).map_err(|e| e.to_string())
}

/// 读取密码。无条目时返回 Ok(None)。
pub fn get(reference: &str) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(SERVICE, reference).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// 删除密码。无条目时视作成功（幂等）。
pub fn delete(reference: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, reference).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Once;

    static INIT: Once = Once::new();
    fn use_mock() {
        // 进程级只设一次 mock 后端。
        INIT.call_once(|| {
            keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        });
    }

    #[test]
    fn store_get_delete_roundtrip() {
        use_mock();
        let r = "host-roundtrip";
        assert_eq!(get(r).unwrap(), None);
        store(r, "s3cret").unwrap();
        assert_eq!(get(r).unwrap(), Some("s3cret".to_string()));
        delete(r).unwrap();
        assert_eq!(get(r).unwrap(), None);
        // 再删一次应幂等
        delete(r).unwrap();
    }

    #[test]
    fn overwrite_updates_secret() {
        use_mock();
        let r = "host-overwrite";
        store(r, "old").unwrap();
        store(r, "new").unwrap();
        assert_eq!(get(r).unwrap(), Some("new".to_string()));
        delete(r).unwrap();
    }
}
```
> 注：keyring mock 的 `NoEntry` 行为——mock 后端在未设置时 `get_password` 返回 `Err(NoEntry)`，与上面匹配一致。若实际 mock 行为不同（例如返回别的错误变体），按编译/测试结果微调匹配分支，并在报告说明。

- [ ] **Step 3: 声明模块**

In `src-tauri/src/lib.rs` 模块声明区加：
```rust
mod credential_vault;
```

- [ ] **Step 4: 跑测试**

Run:
```bash
cd src-tauri && cargo test credential_vault:: 2>&1 | tail -15
```
Expected: `store_get_delete_roundtrip` 和 `overwrite_updates_secret` 均 `ok`。
> 若加 keyring 后首次编译报某平台 feature/依赖问题，以实际编译为准调整 features（目标是 Linux 能编译+mock 测试通过、Windows 用 windows-native）。

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "feat: 新增 credential_vault 钥匙串封装（mock 单元测试）"
```

---

### Task 2: 删组级联（外键 ON DELETE SET NULL）

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/connection_store.rs`（测试）

- [ ] **Step 1: schema 加外键**

In `src-tauri/src/db.rs`，把 `hosts` 表的 `group_id` 列定义改为带外键（其余列不变）：
```rust
            group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
```
即 `init_schema` 的 hosts 建表语句中 `group_id TEXT,` 这一行替换为上面这行。

- [ ] **Step 2: 开启外键 PRAGMA**

SQLite 默认不强制外键，需每连接开启。在 `init_schema` 函数体最开头（`execute_batch` 之前）加：
```rust
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
```

- [ ] **Step 3: 写级联测试**

在 `src-tauri/src/connection_store.rs` 的 `mod tests` 内追加：
```rust
    #[test]
    fn deleting_group_nulls_member_host_group_id() {
        let c = mem();
        let g = create_group(&c, "组A", None).unwrap();
        let mut h = sample_host("h-cascade");
        h.group_id = Some(g.id.clone());
        upsert_host(&c, &h).unwrap();
        // 删除分组
        delete_group(&c, &g.id).unwrap();
        // 主机仍在，但 group_id 被置空
        let got = get_host(&c, "h-cascade").unwrap().unwrap();
        assert_eq!(got.group_id, None);
        // 分组已删
        assert!(list_groups(&c).unwrap().is_empty());
    }
```
> 注：`mem()` 辅助函数（阶段一已有）调用 `init_schema`，因此外键 PRAGMA 在测试连接上也会开启——级联才会生效。确认 `mem()` 用的是 `init_schema`（而非裸 `Connection`）。

- [ ] **Step 4: 跑测试**

Run:
```bash
cd src-tauri && cargo test connection_store:: 2>&1 | tail -15
```
Expected: 新增的 `deleting_group_nulls_member_host_group_id` 通过，且阶段一的 group/host 测试全部仍通过。

- [ ] **Step 5: 在生产连接上也开启外键**

`lib.rs` 的 `.setup()` 里通过 `init_schema` 打开数据库——由于 Step 2 把 PRAGMA 放进了 `init_schema`，生产连接已覆盖，无需额外改动。**确认** `lib.rs` setup 调用的是 `db::init_schema(&conn)`（阶段一即如此），无需修改。

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat: 删除分组时级联置空成员主机 group_id（外键 ON DELETE SET NULL）"
```

---

### Task 3: save_host / connect 重构 / delete_host 删凭据

**Files:**
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: 新增 save_host_cmd**

在 `src-tauri/src/commands.rs` 顶部 import 区加：
```rust
use crate::credential_vault;
```
在 `upsert_host_cmd` 之后追加：
```rust
/// 保存主机：写库 + （若提供明文密码）存入钥匙串并把 credential_ref 设为 host.id。
/// 前端在新增/编辑主机时调用；密码只在这里短暂经过后端，存入钥匙串后不再返回前端。
#[tauri::command]
pub fn save_host_cmd(db: State<Db>, mut host: Host, password: Option<String>) -> Result<(), String> {
    if let Some(pw) = password {
        if !pw.is_empty() {
            credential_vault::store(&host.id, &pw)?;
            host.credential_ref = Some(host.id.clone());
            host.auth_type = "password".to_string();
        }
    }
    let c = db.0.lock().map_err(map_err)?;
    cs::upsert_host(&c, &host).map_err(map_err)
}
```

- [ ] **Step 2: 改 delete_host_cmd 同时删凭据**

把现有 `delete_host_cmd` 替换为：
```rust
#[tauri::command]
pub fn delete_host_cmd(db: State<Db>, id: String) -> Result<(), String> {
    // 先取出 host 看是否有 credential_ref，删库后清钥匙串。
    let credential_ref = {
        let c = db.0.lock().map_err(map_err)?;
        let host = cs::get_host(&c, &id).map_err(map_err)?;
        cs::delete_host(&c, &id).map_err(map_err)?;
        host.and_then(|h| h.credential_ref)
    };
    if let Some(r) = credential_ref {
        credential_vault::delete(&r)?;
    }
    Ok(())
}
```

- [ ] **Step 3: 重构 connect_cmd（按 host_id 取钥匙串密码）**

把现有 `connect_cmd` 整体替换为：
```rust
/// 建立 SSH 会话：按 host_id 读库 + 从钥匙串取密码，再建链开 PTY。
///
/// 重要并发约束：rusqlite 的 Connection / MutexGuard 不是 Send，不能跨 await 持有。
/// 因此在 await 之前同步取出 host 信息和密码并释放锁，再 await spawn_session。
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
    // —— 同步段：取 host + 密码，随即释放锁 ——
    let (address, port, username, password) = {
        let c = db.0.lock().map_err(map_err)?;
        let host = cs::get_host(&c, &host_id)
            .map_err(map_err)?
            .ok_or_else(|| "主机不存在".to_string())?;
        drop(c); // 显式释放，确保不跨 await
        let password = match host.credential_ref.as_deref() {
            Some(r) => credential_vault::get(r)?
                .ok_or_else(|| "未找到该主机的已保存凭据，请先在主机编辑里填写密码".to_string())?,
            None => return Err("该主机未配置密码凭据，请先编辑主机填写密码".to_string()),
        };
        (host.address, host.port, host.username, password)
    };

    // —— 异步段：建链 ——
    let app_data = app.clone();
    let sid_data = session_id.clone();
    let app_close = app.clone();
    let sid_close = session_id.clone();

    let tx = spawn_session(
        address,
        port,
        username,
        password,
        cols,
        rows,
        move |chunk| {
            let _ = app_data.emit(&format!("ssh://{sid_data}/data"), chunk);
        },
        move || {
            let _ = app_close.emit(&format!("ssh://{sid_close}/closed"), ());
        },
    )
    .await?;

    sessions.register(session_id, tx);
    Ok(())
}
```
> 注意：`{ let c = db.0.lock()...; ... }` 整个块求值出 `(address,port,username,password)`，块结束时 `c` 已 drop（`drop(c)` 显式提前释放更稳妥）。`credential_vault::get` 是同步调用，在 await 之前完成。

- [ ] **Step 4: 编译确认**

Run:
```bash
cd src-tauri && cargo build 2>&1 | tail -20
```
Expected: 无 error。`connect_cmd` 不再有 `password`/`address`/`port`/`username` 入参（前端 Task 5 同步改）。

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "feat: save_host 存钥匙串、connect 按 host 取凭据、delete_host 清凭据"
```

---

### Task 4: 注册命令

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 注册 save_host_cmd**

在 `lib.rs` 的 `tauri::generate_handler![...]` 列表里，`commands::upsert_host_cmd,` 之后加一行：
```rust
            commands::save_host_cmd,
```
（`upsert_host_cmd` 保留——它仍被 devtools/测试直接用；`save_host_cmd` 是带凭据的高层入口。）

- [ ] **Step 2: 编译 + 全量后端测试**

Run:
```bash
cd src-tauri && cargo build 2>&1 | tail -10 && cargo test --lib 2>&1 | grep "test result"
```
Expected: 编译无 error；单元测试全过（含新增的 credential_vault、级联测试）。

- [ ] **Step 3: Commit**
```bash
git add -A
git commit -m "feat: 注册 save_host_cmd 命令"
```

---

## 里程碑 B：前端主机管理 UI

### Task 5: 前端 IPC 调整

**Files:**
- Modify: `src/ipc/index.ts`
- Modify: `src/stores/connections.ts`

- [ ] **Step 1: 调整 ipc 的 api 与 session**

In `src/ipc/index.ts`，在 `api` 对象里 `upsertHost` 之后加 `saveHost`，并保留 `upsertHost`/`deleteHost`：
```ts
  saveHost: (host: Host, password: string | null) =>
    invoke<void>("save_host_cmd", { host, password }),
```
并把 `session.connect` 改为按 hostId（去掉 address/port/username/password）：
```ts
  connect: (p: { sessionId: string; hostId: string; cols: number; rows: number }) =>
    invoke<void>("connect_cmd", p),
```
（`write`/`resize`/`close`/`onData`/`onClosed` 不变。）

- [ ] **Step 2: 调整 connections store**

In `src/stores/connections.ts`，把 `saveHost` 改为带密码、并新增 `removeGroup`：
```ts
  saveHost: (host: Host, password: string | null) => Promise<void>;
  removeGroup: (id: string) => Promise<void>;
```
实现里：
```ts
  saveHost: async (host, password) => {
    await api.saveHost(host, password);
    await get().load();
  },
  removeGroup: async (id) => {
    await api.deleteGroup(id);
    await get().load();
  },
```
（`addGroup`/`removeHost`/`load` 保留。）

- [ ] **Step 3: 类型检查**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -10
```
Expected: 因为 App.tsx / TerminalView 仍用旧 `session.connect` 签名，**这里可能报类型错误**——这是预期的，会在 Task 8 修复。若只剩 App.tsx/TerminalView 相关错误，继续；若 ipc/store 自身有错，先修。

- [ ] **Step 4: Commit**
```bash
git add src/ipc/index.ts src/stores/connections.ts
git commit -m "feat: 前端 ipc/store 支持 saveHost(带密码) 与按 hostId 连接"
```

---

### Task 6: 主机新增/编辑表单组件

**Files:**
- Create: `src/components/HostForm.tsx`
- Create: `src/components/HostForm.test.tsx`

- [ ] **Step 1: 写表单测试（先红）**

Create `src/components/HostForm.test.tsx`:
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { HostForm } from "./HostForm";

describe("HostForm", () => {
  it("新增模式：填写字段并提交，回调收到 host 与密码", () => {
    const onSubmit = vi.fn();
    render(<HostForm groups={[]} initial={null} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "web1" } });
    fireEvent.change(screen.getByLabelText("地址"), { target: { value: "10.0.0.1" } });
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "root" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "pw" } });
    fireEvent.click(screen.getByText("保存"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [host, password] = onSubmit.mock.calls[0];
    expect(host.name).toBe("web1");
    expect(host.address).toBe("10.0.0.1");
    expect(host.username).toBe("root");
    expect(host.port).toBe(22);
    expect(password).toBe("pw");
    expect(host.id).toBeTruthy(); // 新增自动生成 id
  });

  it("编辑模式：预填 initial，密码留空则提交 null（不改钥匙串）", () => {
    const onSubmit = vi.fn();
    const initial = {
      id: "h1", name: "old", address: "1.1.1.1", port: 2222, username: "u",
      groupId: null, tags: [], authType: "password", credentialRef: "h1", proxyJump: null,
    };
    render(<HostForm groups={[]} initial={initial} onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("old");
    expect((screen.getByLabelText("端口") as HTMLInputElement).value).toBe("2222");
    fireEvent.click(screen.getByText("保存"));
    const [host, password] = onSubmit.mock.calls[0];
    expect(host.id).toBe("h1"); // 保持原 id
    expect(password).toBeNull(); // 密码留空 → null
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
npx vitest run src/components/HostForm.test.tsx 2>&1 | tail -12
```
Expected: FAIL — 找不到 `./HostForm`。

- [ ] **Step 3: 实现表单组件**

Create `src/components/HostForm.tsx`:
```tsx
import { useState } from "react";
import type { Group, Host } from "../ipc";

function newId(): string {
  // 浏览器原生 UUID；测试环境（jsdom）也支持 crypto.randomUUID。
  return crypto.randomUUID();
}

export function HostForm({
  groups,
  initial,
  onSubmit,
  onCancel,
}: {
  groups: Group[];
  initial: Host | null;
  onSubmit: (host: Host, password: string | null) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [port, setPort] = useState(String(initial?.port ?? 22));
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [groupId, setGroupId] = useState(initial?.groupId ?? "");
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const host: Host = {
      id: initial?.id ?? newId(),
      name,
      address,
      port: parseInt(port, 10) || 22,
      username,
      groupId: groupId || null,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      authType: "password",
      credentialRef: initial?.credentialRef ?? null,
      proxyJump: initial?.proxyJump ?? null,
    };
    // 密码留空：编辑模式表示"不改动已存凭据"，新增模式表示暂不设密码 → 传 null
    onSubmit(host, password ? password : null);
  };

  const field = (label: string, value: string, set: (v: string) => void, type = "text") => (
    <label style={{ display: "block", marginBottom: 8 }}>
      <span style={{ display: "inline-block", width: 64 }}>{label}</span>
      <input
        aria-label={label}
        type={type}
        value={value}
        onChange={(e) => set(e.target.value)}
        style={{ width: 200 }}
      />
    </label>
  );

  return (
    <form onSubmit={submit} style={{ padding: 16, border: "1px solid #444", background: "#222" }}>
      <h3>{initial ? "编辑主机" : "新增主机"}</h3>
      {field("名称", name, setName)}
      {field("地址", address, setAddress)}
      {field("端口", port, setPort)}
      {field("用户名", username, setUsername)}
      {field("密码", password, setPassword, "password")}
      <label style={{ display: "block", marginBottom: 8 }}>
        <span style={{ display: "inline-block", width: 64 }}>分组</span>
        <select aria-label="分组" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">未分组</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </label>
      {field("标签", tags, setTags)}
      <div style={{ marginTop: 12 }}>
        <button type="submit">保存</button>
        <button type="button" onClick={onCancel} style={{ marginLeft: 8 }}>取消</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
npx vitest run src/components/HostForm.test.tsx 2>&1 | tail -12
```
Expected: 2 passed。

- [ ] **Step 5: Commit**
```bash
git add src/components/HostForm.tsx src/components/HostForm.test.tsx
git commit -m "feat: 主机新增/编辑表单组件（含测试）"
```

---

### Task 7: Sidebar 增删改入口

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/Sidebar.test.tsx`

- [ ] **Step 1: 更新 Sidebar 测试**

把 `src/components/Sidebar.test.tsx` 的 mock 返回值补上 `removeGroup: vi.fn()`，并新增两个交互测试。具体：在 `mockReturnValue({...})` 对象里加一行 `removeGroup: vi.fn(),`；并在 `describe` 内追加：
```tsx
  it("点击主机的编辑按钮触发 onEditHost", () => {
    const onEditHost = vi.fn();
    render(<Sidebar onConnect={vi.fn()} onNewHost={vi.fn()} onEditHost={onEditHost} />);
    fireEvent.click(screen.getByLabelText("编辑 web1"));
    expect(onEditHost).toHaveBeenCalledWith("h1");
  });

  it("点击“+ 主机”触发 onNewHost", () => {
    const onNewHost = vi.fn();
    render(<Sidebar onConnect={vi.fn()} onNewHost={onNewHost} onEditHost={vi.fn()} />);
    fireEvent.click(screen.getByText("+ 主机"));
    expect(onNewHost).toHaveBeenCalled();
  });
```
并确保文件顶部从 `@testing-library/react` 导入了 `fireEvent`（与已有 import 合并）。同时把已有两个测试里的 `<Sidebar onConnect={...} />` 调用补上新 props：`onNewHost={vi.fn()} onEditHost={vi.fn()}`（否则 TS 报缺 props）。

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
npx vitest run src/components/Sidebar.test.tsx 2>&1 | tail -15
```
Expected: FAIL（Sidebar 还没有新 props 与按钮）。

- [ ] **Step 3: 更新 Sidebar 组件**

把 `src/components/Sidebar.tsx` 整体替换为：
```tsx
import { useEffect } from "react";
import { useConnections } from "../stores/connections";

export function Sidebar({
  onConnect,
  onNewHost,
  onEditHost,
}: {
  onConnect: (hostId: string) => void;
  onNewHost: () => void;
  onEditHost: (hostId: string) => void;
}) {
  const { groups, hosts, load, addGroup, removeHost, removeGroup } = useConnections();

  useEffect(() => {
    load();
  }, [load]);

  const hostRow = (h: { id: string; name: string }) => (
    <div key={h.id} style={{ display: "flex", alignItems: "center", padding: "4px 20px" }}>
      <span
        onClick={() => onConnect(h.id)}
        style={{ flex: 1, cursor: "pointer" }}
      >
        {h.name}
      </span>
      <button aria-label={`编辑 ${h.name}`} onClick={() => onEditHost(h.id)}>✎</button>
      <button aria-label={`删除 ${h.name}`} onClick={() => removeHost(h.id)}>🗑</button>
    </div>
  );

  const ungrouped = hosts.filter((h) => !h.groupId);

  return (
    <aside style={{ width: 260, borderRight: "1px solid #333", overflow: "auto" }}>
      <div style={{ display: "flex" }}>
        <button onClick={() => addGroup("新分组")} style={{ flex: 1 }}>+ 新分组</button>
        <button onClick={onNewHost} style={{ flex: 1 }}>+ 主机</button>
      </div>
      {groups.map((g) => (
        <div key={g.id}>
          <div style={{ fontWeight: 600, padding: "4px 8px", display: "flex" }}>
            <span style={{ flex: 1 }}>▾ {g.name}</span>
            <button aria-label={`删除分组 ${g.name}`} onClick={() => removeGroup(g.id)}>🗑</button>
          </div>
          {hosts.filter((h) => h.groupId === g.id).map(hostRow)}
        </div>
      ))}
      {ungrouped.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, padding: "4px 8px" }}>▾ 未分组</div>
          {ungrouped.map(hostRow)}
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
npx vitest run src/components/Sidebar.test.tsx 2>&1 | tail -15
```
Expected: 4 passed（原 2 + 新 2）。

- [ ] **Step 5: Commit**
```bash
git add src/components/Sidebar.tsx src/components/Sidebar.test.tsx
git commit -m "feat: 侧边栏主机增删改与删组入口（含测试）"
```

---

### Task 8: App 接线（表单弹窗 + 连接改造）

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/TerminalView.tsx`

- [ ] **Step 1: 改 TerminalView 的连接调用**

In `src/components/TerminalView.tsx`，把 props 的 `conn` 由"连接明细"改为 `hostId`，并相应改 `session.connect` 调用。具体替换组件签名与 connect 段：
```tsx
export function TerminalView({
  sessionId,
  hostId,
}: {
  sessionId: string;
  hostId: string;
}) {
```
并把 `useEffect` 内的 `await session.connect({...})` 改为：
```tsx
      try {
        await session.connect({ sessionId, hostId, cols: term.cols, rows: term.rows });
      } catch (e) {
        term.write(`\r\n[连接失败] ${e}\r\n`);
      }
```
并把 effect 依赖数组由 `[sessionId, conn]` 改为 `[sessionId, hostId]`。（其余 onData/onClosed/onData(input)/resize/cleanup 不变。）

- [ ] **Step 2: 改 App.tsx**

把 `src/App.tsx` 整体替换为：
```tsx
import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { TerminalView } from "./components/TerminalView";
import { HostForm } from "./components/HostForm";
import { useConnections } from "./stores/connections";
import type { Host } from "./ipc";

function App() {
  const { hosts, groups, saveHost } = useConnections();
  const [activeSession, setActiveSession] = useState<{ sessionId: string; hostId: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Host | null>(null);

  const handleConnect = (hostId: string) => {
    // 后端按 hostId 从钥匙串取密码；前端不再处理明文。
    setActiveSession({ sessionId: `${hostId}-${Date.now()}`, hostId });
  };

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (hostId: string) => {
    setEditing(hosts.find((h) => h.id === hostId) ?? null);
    setFormOpen(true);
  };
  const submitForm = async (host: Host, password: string | null) => {
    await saveHost(host, password);
    setFormOpen(false);
  };

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <Sidebar onConnect={handleConnect} onNewHost={openNew} onEditHost={openEdit} />
      <main style={{ flex: 1, position: "relative" }} data-testid="terminal-area">
        {activeSession ? (
          <TerminalView key={activeSession.sessionId} sessionId={activeSession.sessionId} hostId={activeSession.hostId} />
        ) : (
          <div style={{ padding: 16, color: "#888" }}>从左侧选择主机以连接</div>
        )}
        {formOpen && (
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <HostForm groups={groups} initial={editing} onSubmit={submitForm} onCancel={() => setFormOpen(false)} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
```
> `Date.now()` 用于生成唯一 sessionId（阶段一是固定 `${hostId}-1`）——多标签 Part 2 会进一步管理，这里先保证每次连接唯一。

- [ ] **Step 3: 类型检查 + 前端测试 + 构建**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -10
npx vitest run 2>&1 | tail -12
npm run build 2>&1 | tail -6
```
Expected: tsc 无错；vitest 全过（Sidebar 4 + HostForm 2）；build 成功。

- [ ] **Step 4: Commit**
```bash
git add src/App.tsx src/components/TerminalView.tsx
git commit -m "feat: App 接入主机表单弹窗，连接改为按 hostId（去除 window.prompt 明文密码）"
```

---

### Task 9: 端到端验证 + 回归

**Files:** 无（验证任务）

- [ ] **Step 1: 后端全量测试**

Run:
```bash
cd src-tauri && cargo test --lib 2>&1 | grep "test result"
```
Expected: 全过（含 credential_vault mock 测试、删组级联测试、阶段一 CRUD/SSH 单元测试）。

- [ ] **Step 2: 前端全量测试 + 类型 + 构建**

Run:
```bash
cd /home/deng/workspace/ssh_client
npx vitest run 2>&1 | tail -8
npx tsc --noEmit 2>&1 | tail -5
npm run build 2>&1 | tail -6
```
Expected: 全过。

- [ ] **Step 3: 整体编译（确保 Tauri 命令签名前后端一致能跑）**

Run:
```bash
npm run tauri build -- --no-bundle 2>&1 | tail -15
```
Expected: 编译通过，无 error。

- [ ] **Step 4: GUI 手动验证清单（留待有显示器环境，由人执行）**

记录以下待人工验证项（headless 无法自动化）：
1. 点"+ 主机"，填写 name/address(127.0.0.1)/port(2222)/username(tester)/密码(testpass)，选未分组，保存 → 侧边栏出现该主机（无需 devtools）。
2. 点该主机 → 终端连上（后端从钥匙串取密码），`echo hi` 有回显。**全程没有任何明文密码输入框弹出。**
3. 点主机"✎"编辑、改名保存 → 列表更新；密码留空保存 → 仍能连接（钥匙串凭据未被清空）。
4. 新建分组，编辑主机归入该分组，删除该分组 → 主机回到"未分组"（级联置空生效，主机未消失）。
5. 删除主机"🗑" → 主机消失；（Windows 上）确认凭据管理器里对应条目被清除。

> 测试容器 `ssh-itest`（tester/testpass @ 127.0.0.1:2222）需在运行：`./scripts/test-sshd.sh`。

- [ ] **Step 5: 完成报告**

汇总自动化测试结果，列出 Step 4 待人工验证清单交付。

---

## Part 1 完成标准（Definition of Done）

- 凭据存系统钥匙串，数据库与前端不再有明文密码；`window.prompt` 已移除。
- GUI 可新增/编辑/删除主机，无需 devtools。
- 连接按 host 从钥匙串取凭据；无凭据时给出明确提示。
- 删除分组级联置空成员主机 group_id（主机不丢失）。
- 后端单元测试（含 keyring mock）、前端组件测试、tsc、`tauri build --no-bundle` 全绿。

## Part 2 预告（下一个计划）

多标签并发会话（标签栏 + session store + sessionId 已唯一化为 `${hostId}-${Date.now()}`）、命令面板（Ctrl+K 模糊搜索 + 一键连接）、TerminalView resize 改 ResizeObserver、改正式包名（`ssh-client-scaffold` → 正式名，影响 exe 文件名）并重新交叉编译验证。

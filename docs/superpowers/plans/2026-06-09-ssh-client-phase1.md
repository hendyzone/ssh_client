# SSH 客户端 — 阶段一（地基）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭好 Tauri + React 工程与 IPC 通路，实现连接管理（SQLite + 分组/标签 + 侧边栏），并打通"点击主机 → russh 建链 → PTY → xterm 双向流"的单会话终端，产出一个能连服务器、能用单终端的可运行软件。

**Architecture:** 前端 React + xterm.js（WebView2）只负责展示与交互，绝不接触明文凭据；Rust 后端用 russh 建立 SSH 会话、开 PTY 通道，配置存 SQLite。前后端通过 Tauri `invoke`（命令）+ `emit/listen`（事件流）通信。

**Tech Stack:** Tauri 2.x、React + TypeScript + Vite、zustand、xterm.js、Rust、russh、rusqlite。

**目标平台说明:** 最终主要面向 Windows（PTY 用 ConPTY 不影响本设计，因为 PTY 在远端由 russh 请求；本地无需 PTY）。日常在 Linux 开发，SSH 集成测试用 Docker 起本地 sshd。Windows 专属验证（WebView2 打包、Credential Manager）留到阶段二/三。

---

## 文件结构

阶段一会创建/修改下列文件，每个文件单一职责：

**Rust 后端（`src-tauri/src/`）**
- `lib.rs` — Tauri 应用入口，注册命令与状态。
- `db.rs` — SQLite 连接初始化与建表迁移。
- `models.rs` — `Host`、`Group` 数据结构（serde 序列化）。
- `connection_store.rs` — Host/Group 的 CRUD（纯逻辑，对传入的 `Connection` 操作，可单元测试）。
- `ssh_session.rs` — russh 客户端 Handler、建链、认证、开 PTY、读写、resize、关闭。
- `session_manager.rs` — 管理多个活跃会话（`session_id -> 会话句柄`），阶段一只跑单会话但接口预留多会话。
- `commands.rs` — Tauri 命令入口，把上面模块暴露给前端。

**React 前端（`src/`）**
- `ipc/index.ts` — 封装所有 `invoke` 调用与事件订阅，前端唯一与后端通信的出口。
- `stores/connections.ts` — zustand store：分组/主机列表及增删改。
- `stores/sessions.ts` — zustand store：活跃会话/标签状态。
- `components/Sidebar.tsx` — 分组树 + 主机列表 + 增删改。
- `components/TerminalView.tsx` — xterm.js 终端组件，绑定会话事件流。
- `App.tsx` — 整体布局（侧边栏 + 终端区）。

---

## 里程碑 1：工程骨架与 IPC 通路

### Task 1: 脚手架 Tauri + React + TS 工程

**Files:**
- Create: 整个 `src-tauri/`、`src/`、`package.json`、`vite.config.ts` 等（由脚手架生成）
- 保留: 已存在的 `docs/`、`.git/`

> 脚手架工具拒绝在非空目录运行，因此先生成到临时目录再合并回来，保留 `docs/` 与 git 历史。

- [ ] **Step 1: 在临时目录生成 Tauri 工程**

Run:
```bash
cd /tmp && npm create tauri-app@latest ssh-client-scaffold -- \
  --template react-ts --manager npm --identifier com.dengssh.client -y
```
Expected: `/tmp/ssh-client-scaffold/` 下生成 `src/`、`src-tauri/`、`package.json` 等。

- [ ] **Step 2: 合并脚手架到项目目录（不覆盖 docs/.git）**

Run:
```bash
cd /home/deng/workspace/ssh_client
rsync -a --exclude='.git' --exclude='docs' /tmp/ssh-client-scaffold/ ./
rm -rf /tmp/ssh-client-scaffold
```
Expected: 项目根出现 `package.json`、`src/`、`src-tauri/`，`docs/` 与 `.git/` 原样保留。

- [ ] **Step 3: 安装依赖并验证开发构建可启动**

Run:
```bash
npm install
npm run tauri build -- --no-bundle 2>&1 | tail -20
```
Expected: Rust 与前端均编译通过（首次会拉取较多 crate，耐心等待），结尾无 error。

> 注：Linux 开发机需安装 Tauri 系统依赖（`webkit2gtk`、`libgtk-3-dev` 等）。若编译报缺库，按报错安装对应包后重试。

- [ ] **Step 4: 添加 .gitignore**

Create `/home/deng/workspace/ssh_client/.gitignore`:
```gitignore
node_modules/
dist/
src-tauri/target/
*.log
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: 初始化 Tauri + React + TS 工程脚手架"
```

---

### Task 2: 打通第一个 IPC 命令（健康检查）

验证前后端 IPC 通路可用，作为后续所有命令的范式。

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/commands.rs`
- Modify: `src/App.tsx`

- [ ] **Step 1: 写后端命令测试（纯函数部分）**

Create `src-tauri/src/commands.rs`:
```rust
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
```

- [ ] **Step 2: 注册模块与命令**

In `src-tauri/src/lib.rs`, add near the top:
```rust
mod commands;
```
And in the `run()` builder, register the handler (合并进已有的 `tauri::Builder`):
```rust
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::health])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
```

- [ ] **Step 3: 运行 Rust 测试，确认通过**

Run:
```bash
cd src-tauri && cargo test commands:: 2>&1 | tail -10
```
Expected: `test commands::tests::health_includes_name ... ok`

- [ ] **Step 4: 前端调用并显示结果**

Replace body of `src/App.tsx` with:
```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

function App() {
  const [health, setHealth] = useState("…");
  useEffect(() => {
    invoke<string>("health").then(setHealth).catch((e) => setHealth(`err: ${e}`));
  }, []);
  return <div data-testid="health">{health}</div>;
}

export default App;
```

- [ ] **Step 5: 手动验证 IPC**

Run:
```bash
npm run tauri dev
```
Expected: 应用窗口显示 `ssh-client 0.1.0`（版本以 package 为准）。确认后关闭。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: 打通第一个 IPC 命令 health 验证前后端通路"
```

---

## 里程碑 2：连接管理（SQLite + 分组/标签 + 侧边栏）

### Task 3: 数据模型与 SQLite 建表

**Files:**
- Create: `src-tauri/src/models.rs`
- Create: `src-tauri/src/db.rs`
- Modify: `src-tauri/Cargo.toml`（加依赖）
- Modify: `src-tauri/src/lib.rs`（声明模块）

- [ ] **Step 1: 加 Rust 依赖**

In `src-tauri/Cargo.toml` under `[dependencies]`, add:
```toml
rusqlite = { version = "0.31", features = ["bundled"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
uuid = { version = "1", features = ["v4"] }
```
(`bundled` 让 rusqlite 自带 SQLite，免去系统库依赖，对 Windows 打包友好。)

- [ ] **Step 2: 定义数据模型**

Create `src-tauri/src/models.rs`:
```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
    pub auth_type: String,          // "password" | "key" | "agent"
    pub credential_ref: Option<String>,
    pub proxy_jump: Option<String>,
}
```

- [ ] **Step 3: 写建表测试**

Create `src-tauri/src/db.rs`:
```rust
use rusqlite::Connection;

/// 在给定连接上建表（幂等）。
pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id TEXT
        );
        CREATE TABLE IF NOT EXISTS hosts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            address TEXT NOT NULL,
            port INTEGER NOT NULL,
            username TEXT NOT NULL,
            group_id TEXT,
            tags TEXT NOT NULL,            -- JSON 数组字符串
            auth_type TEXT NOT NULL,
            credential_ref TEXT,
            proxy_jump TEXT
        );
        ",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_creates_tables() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        // 再次调用应幂等，不报错
        init_schema(&conn).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('groups','hosts')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }
}
```

- [ ] **Step 4: 声明模块**

In `src-tauri/src/lib.rs` add:
```rust
mod models;
mod db;
```

- [ ] **Step 5: 运行测试**

Run:
```bash
cd src-tauri && cargo test db:: 2>&1 | tail -10
```
Expected: `test db::tests::schema_creates_tables ... ok`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: 定义 Host/Group 模型与 SQLite 建表"
```

---

### Task 4: Group CRUD

**Files:**
- Create: `src-tauri/src/connection_store.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 写 Group CRUD 测试**

Create `src-tauri/src/connection_store.rs`:
```rust
use crate::models::{Group, Host};
use rusqlite::Connection;

pub fn create_group(conn: &Connection, name: &str, parent_id: Option<&str>) -> rusqlite::Result<Group> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO groups (id, name, parent_id) VALUES (?1, ?2, ?3)",
        rusqlite::params![id, name, parent_id],
    )?;
    Ok(Group { id, name: name.to_string(), parent_id: parent_id.map(String::from) })
}

pub fn list_groups(conn: &Connection) -> rusqlite::Result<Vec<Group>> {
    let mut stmt = conn.prepare("SELECT id, name, parent_id FROM groups ORDER BY name")?;
    let rows = stmt.query_map([], |r| {
        Ok(Group { id: r.get(0)?, name: r.get(1)?, parent_id: r.get(2)? })
    })?;
    rows.collect()
}

pub fn rename_group(conn: &Connection, id: &str, name: &str) -> rusqlite::Result<()> {
    conn.execute("UPDATE groups SET name = ?2 WHERE id = ?1", rusqlite::params![id, name])?;
    Ok(())
}

pub fn delete_group(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM groups WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_schema;

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        init_schema(&c).unwrap();
        c
    }

    #[test]
    fn create_and_list_group() {
        let c = mem();
        let g = create_group(&c, "生产组", None).unwrap();
        let all = list_groups(&c).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "生产组");
        assert_eq!(all[0].id, g.id);
    }

    #[test]
    fn rename_and_delete_group() {
        let c = mem();
        let g = create_group(&c, "旧名", None).unwrap();
        rename_group(&c, &g.id, "新名").unwrap();
        assert_eq!(list_groups(&c).unwrap()[0].name, "新名");
        delete_group(&c, &g.id).unwrap();
        assert!(list_groups(&c).unwrap().is_empty());
    }
}
```

- [ ] **Step 2: 声明模块**

In `src-tauri/src/lib.rs` add:
```rust
mod connection_store;
```

- [ ] **Step 3: 运行测试，确认通过**

Run:
```bash
cd src-tauri && cargo test connection_store::tests::create_and_list_group connection_store::tests::rename_and_delete_group 2>&1 | tail -10
```
Expected: 两个测试均 `ok`。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: Group CRUD"
```

---

### Task 5: Host CRUD

**Files:**
- Modify: `src-tauri/src/connection_store.rs`

- [ ] **Step 1: 写 Host CRUD 测试与实现**

Append to `src-tauri/src/connection_store.rs` (在 `#[cfg(test)]` 之前):
```rust
fn row_to_host(r: &rusqlite::Row) -> rusqlite::Result<Host> {
    let tags_json: String = r.get(6)?;
    Ok(Host {
        id: r.get(0)?,
        name: r.get(1)?,
        address: r.get(2)?,
        port: r.get(3)?,
        username: r.get(4)?,
        group_id: r.get(5)?,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        auth_type: r.get(7)?,
        credential_ref: r.get(8)?,
        proxy_jump: r.get(9)?,
    })
}

pub fn upsert_host(conn: &Connection, host: &Host) -> rusqlite::Result<()> {
    let tags_json = serde_json::to_string(&host.tags).unwrap();
    conn.execute(
        "INSERT INTO hosts (id, name, address, port, username, group_id, tags, auth_type, credential_ref, proxy_jump)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
         ON CONFLICT(id) DO UPDATE SET
           name=?2, address=?3, port=?4, username=?5, group_id=?6,
           tags=?7, auth_type=?8, credential_ref=?9, proxy_jump=?10",
        rusqlite::params![
            host.id, host.name, host.address, host.port, host.username,
            host.group_id, tags_json, host.auth_type, host.credential_ref, host.proxy_jump
        ],
    )?;
    Ok(())
}

pub fn list_hosts(conn: &Connection) -> rusqlite::Result<Vec<Host>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, address, port, username, group_id, tags, auth_type, credential_ref, proxy_jump
         FROM hosts ORDER BY name",
    )?;
    let rows = stmt.query_map([], row_to_host)?;
    rows.collect()
}

pub fn get_host(conn: &Connection, id: &str) -> rusqlite::Result<Option<Host>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, address, port, username, group_id, tags, auth_type, credential_ref, proxy_jump
         FROM hosts WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(rusqlite::params![id], row_to_host)?;
    match rows.next() {
        Some(h) => Ok(Some(h?)),
        None => Ok(None),
    }
}

pub fn delete_host(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM hosts WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}
```
Then add these tests inside the existing `mod tests` block:
```rust
    fn sample_host(id: &str) -> Host {
        Host {
            id: id.to_string(),
            name: "web1".into(),
            address: "10.0.0.1".into(),
            port: 22,
            username: "root".into(),
            group_id: None,
            tags: vec!["prod".into(), "web".into()],
            auth_type: "password".into(),
            credential_ref: None,
            proxy_jump: None,
        }
    }

    #[test]
    fn upsert_get_and_list_host() {
        let c = mem();
        let mut h = sample_host("h1");
        upsert_host(&c, &h).unwrap();
        assert_eq!(list_hosts(&c).unwrap().len(), 1);
        // 更新同 id
        h.name = "web1-renamed".into();
        upsert_host(&c, &h).unwrap();
        let got = get_host(&c, "h1").unwrap().unwrap();
        assert_eq!(got.name, "web1-renamed");
        assert_eq!(got.tags, vec!["prod".to_string(), "web".to_string()]);
    }

    #[test]
    fn delete_host_removes_it() {
        let c = mem();
        upsert_host(&c, &sample_host("h1")).unwrap();
        delete_host(&c, "h1").unwrap();
        assert!(get_host(&c, "h1").unwrap().is_none());
    }
```

- [ ] **Step 2: 运行测试**

Run:
```bash
cd src-tauri && cargo test connection_store::tests::upsert_get_and_list_host connection_store::tests::delete_host_removes_it 2>&1 | tail -10
```
Expected: 两个测试均 `ok`。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: Host CRUD（含 tags JSON 序列化）"
```

---

### Task 6: 把连接管理暴露为 Tauri 命令

后端用一个全局 `Mutex<Connection>` 持有数据库，命令层调用 `connection_store`。

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 在 lib.rs 初始化数据库并放入 Tauri 状态**

In `src-tauri/src/lib.rs`, replace the `run()` builder so it opens the DB at the app data dir and manages it as state:
```rust
use std::sync::Mutex;
use rusqlite::Connection;

pub struct Db(pub Mutex<Connection>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;
            let dir = app.path().app_data_dir().expect("no app data dir");
            std::fs::create_dir_all(&dir).ok();
            let conn = Connection::open(dir.join("ssh-client.db")).expect("open db");
            db::init_schema(&conn).expect("init schema");
            app.manage(Db(Mutex::new(conn)));
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 2: 在 commands.rs 写命令包装**

Append to `src-tauri/src/commands.rs`:
```rust
use crate::models::{Group, Host};
use crate::{connection_store as cs, Db};
use tauri::State;

fn map_err<E: std::fmt::Display>(e: E) -> String { e.to_string() }

#[tauri::command]
pub fn list_groups_cmd(db: State<Db>) -> Result<Vec<Group>, String> {
    let c = db.0.lock().map_err(map_err)?;
    cs::list_groups(&c).map_err(map_err)
}

#[tauri::command]
pub fn create_group_cmd(db: State<Db>, name: String, parent_id: Option<String>) -> Result<Group, String> {
    let c = db.0.lock().map_err(map_err)?;
    cs::create_group(&c, &name, parent_id.as_deref()).map_err(map_err)
}

#[tauri::command]
pub fn rename_group_cmd(db: State<Db>, id: String, name: String) -> Result<(), String> {
    let c = db.0.lock().map_err(map_err)?;
    cs::rename_group(&c, &id, &name).map_err(map_err)
}

#[tauri::command]
pub fn delete_group_cmd(db: State<Db>, id: String) -> Result<(), String> {
    let c = db.0.lock().map_err(map_err)?;
    cs::delete_group(&c, &id).map_err(map_err)
}

#[tauri::command]
pub fn list_hosts_cmd(db: State<Db>) -> Result<Vec<Host>, String> {
    let c = db.0.lock().map_err(map_err)?;
    cs::list_hosts(&c).map_err(map_err)
}

#[tauri::command]
pub fn upsert_host_cmd(db: State<Db>, host: Host) -> Result<(), String> {
    let c = db.0.lock().map_err(map_err)?;
    cs::upsert_host(&c, &host).map_err(map_err)
}

#[tauri::command]
pub fn delete_host_cmd(db: State<Db>, id: String) -> Result<(), String> {
    let c = db.0.lock().map_err(map_err)?;
    cs::delete_host(&c, &id).map_err(map_err)
}
```

- [ ] **Step 3: 编译确认无误**

Run:
```bash
cd src-tauri && cargo build 2>&1 | tail -15
```
Expected: 编译通过，无 error。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: 将连接管理暴露为 Tauri 命令（DB 作为应用状态）"
```

---

### Task 7: 前端 IPC 层与 connections store

**Files:**
- Create: `src/ipc/index.ts`
- Create: `src/stores/connections.ts`
- Modify: `package.json`（加 zustand）

- [ ] **Step 1: 安装 zustand**

Run:
```bash
npm install zustand
```

- [ ] **Step 2: 写 IPC 封装**

Create `src/ipc/index.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";

export interface Group {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface Host {
  id: string;
  name: string;
  address: string;
  port: number;
  username: string;
  groupId: string | null;
  tags: string[];
  authType: string;
  credentialRef: string | null;
  proxyJump: string | null;
}

export const api = {
  listGroups: () => invoke<Group[]>("list_groups_cmd"),
  createGroup: (name: string, parentId: string | null) =>
    invoke<Group>("create_group_cmd", { name, parentId }),
  renameGroup: (id: string, name: string) => invoke<void>("rename_group_cmd", { id, name }),
  deleteGroup: (id: string) => invoke<void>("delete_group_cmd", { id }),
  listHosts: () => invoke<Host[]>("list_hosts_cmd"),
  upsertHost: (host: Host) => invoke<void>("upsert_host_cmd", { host }),
  deleteHost: (id: string) => invoke<void>("delete_host_cmd", { id }),
};
```

- [ ] **Step 3: 写 connections store**

Create `src/stores/connections.ts`:
```ts
import { create } from "zustand";
import { api, type Group, type Host } from "../ipc";

interface ConnState {
  groups: Group[];
  hosts: Host[];
  load: () => Promise<void>;
  addGroup: (name: string) => Promise<void>;
  saveHost: (host: Host) => Promise<void>;
  removeHost: (id: string) => Promise<void>;
}

export const useConnections = create<ConnState>((set, get) => ({
  groups: [],
  hosts: [],
  load: async () => {
    const [groups, hosts] = await Promise.all([api.listGroups(), api.listHosts()]);
    set({ groups, hosts });
  },
  addGroup: async (name) => {
    await api.createGroup(name, null);
    await get().load();
  },
  saveHost: async (host) => {
    await api.upsertHost(host);
    await get().load();
  },
  removeHost: async (id) => {
    await api.deleteHost(id);
    await get().load();
  },
}));
```

- [ ] **Step 4: 编译检查（TS 类型）**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -10
```
Expected: 无类型错误。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 前端 IPC 封装与 connections store"
```

---

### Task 8: 侧边栏 UI（分组树 + 主机列表 + 增删改）

**Files:**
- Create: `src/components/Sidebar.tsx`
- Create: `src/components/Sidebar.test.tsx`
- Modify: `src/App.tsx`
- Modify: `package.json`（加 Vitest + Testing Library）

- [ ] **Step 1: 安装测试依赖**

Run:
```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2: 配置 Vitest**

In `vite.config.ts`, add a `test` block to the config object:
```ts
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
```
Create `src/test-setup.ts`:
```ts
import "@testing-library/jest-dom";
```

- [ ] **Step 3: 写侧边栏测试（mock store）**

Create `src/components/Sidebar.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Sidebar } from "./Sidebar";
import { useConnections } from "../stores/connections";

vi.mock("../stores/connections");

describe("Sidebar", () => {
  beforeEach(() => {
    (useConnections as unknown as any).mockReturnValue({
      groups: [{ id: "g1", name: "生产组", parent_id: null }],
      hosts: [
        { id: "h1", name: "web1", address: "10.0.0.1", port: 22, username: "root",
          groupId: "g1", tags: [], authType: "password", credentialRef: null, proxyJump: null },
      ],
      load: vi.fn(),
      addGroup: vi.fn(),
      saveHost: vi.fn(),
      removeHost: vi.fn(),
    });
  });

  it("renders groups and their hosts", () => {
    render(<Sidebar onConnect={vi.fn()} />);
    expect(screen.getByText("生产组")).toBeInTheDocument();
    expect(screen.getByText("web1")).toBeInTheDocument();
  });

  it("calls onConnect when a host is clicked", async () => {
    const onConnect = vi.fn();
    render(<Sidebar onConnect={onConnect} />);
    screen.getByText("web1").click();
    expect(onConnect).toHaveBeenCalledWith("h1");
  });
});
```

- [ ] **Step 4: 运行测试，确认失败（组件未实现）**

Run:
```bash
npx vitest run src/components/Sidebar.test.tsx 2>&1 | tail -15
```
Expected: FAIL — 找不到 `./Sidebar` 模块。

- [ ] **Step 5: 实现侧边栏组件**

Create `src/components/Sidebar.tsx`:
```tsx
import { useEffect } from "react";
import { useConnections } from "../stores/connections";

export function Sidebar({ onConnect }: { onConnect: (hostId: string) => void }) {
  const { groups, hosts, load, addGroup } = useConnections();

  useEffect(() => {
    load();
  }, [load]);

  const ungrouped = hosts.filter((h) => !h.groupId);

  return (
    <aside style={{ width: 240, borderRight: "1px solid #333", overflow: "auto" }}>
      <button onClick={() => addGroup("新分组")} style={{ width: "100%" }}>
        + 新分组
      </button>
      {groups.map((g) => (
        <div key={g.id}>
          <div style={{ fontWeight: 600, padding: "4px 8px" }}>▾ {g.name}</div>
          {hosts
            .filter((h) => h.groupId === g.id)
            .map((h) => (
              <div
                key={h.id}
                onClick={() => onConnect(h.id)}
                style={{ padding: "4px 20px", cursor: "pointer" }}
              >
                {h.name}
              </div>
            ))}
        </div>
      ))}
      {ungrouped.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, padding: "4px 8px" }}>▾ 未分组</div>
          {ungrouped.map((h) => (
            <div
              key={h.id}
              onClick={() => onConnect(h.id)}
              style={{ padding: "4px 20px", cursor: "pointer" }}
            >
              {h.name}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 6: 运行测试，确认通过**

Run:
```bash
npx vitest run src/components/Sidebar.test.tsx 2>&1 | tail -15
```
Expected: 2 passed。

- [ ] **Step 7: 接入 App 布局**

Replace `src/App.tsx`:
```tsx
import { Sidebar } from "./components/Sidebar";

function App() {
  const handleConnect = (hostId: string) => {
    console.log("connect to", hostId); // 里程碑 3 接真实连接
  };
  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <Sidebar onConnect={handleConnect} />
      <main style={{ flex: 1 }} data-testid="terminal-area" />
    </div>
  );
}

export default App;
```

- [ ] **Step 8: 手动验证：新增分组并落库**

Run:
```bash
npm run tauri dev
```
Expected: 点击"+ 新分组"后出现"新分组"，重启应用后仍在（已落 SQLite）。确认后关闭。

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: 侧边栏分组树与主机列表（含组件测试）"
```

---

## 里程碑 3：单会话终端（russh + PTY + xterm）

> **API 版本提醒**：russh 的 `client::Handler` trait 与方法签名随版本变化。实现前先确认 `Cargo.toml` 锁定的 russh 版本，并对照该版本的 docs.rs 示例核对下列签名（尤其 `check_server_key`、`channel_open_session`、`data` 回调）。下方代码以 russh 0.45 系列的典型 API 编写，作为参考实现。

### Task 9: russh 建链 + 密码认证（集成测试用 Docker sshd）

**Files:**
- Create: `src-tauri/src/ssh_session.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Create: `scripts/test-sshd.sh`（本地集成测试用）

- [ ] **Step 1: 加 SSH/异步依赖**

In `src-tauri/Cargo.toml` `[dependencies]`:
```toml
russh = "0.45"
russh-keys = "0.45"
tokio = { version = "1", features = ["full"] }
async-trait = "0.1"
```

- [ ] **Step 2: 准备本地测试 sshd 脚本**

Create `scripts/test-sshd.sh`:
```bash
#!/usr/bin/env bash
# 起一个本地 sshd 容器用于集成测试：root / testpass，端口 2222
set -e
docker rm -f ssh-itest 2>/dev/null || true
docker run -d --name ssh-itest -p 2222:2222 \
  -e PUID=1000 -e PGID=1000 \
  -e PASSWORD_ACCESS=true \
  -e USER_PASSWORD=testpass \
  -e USER_NAME=tester \
  lscr.io/linuxserver/openssh-server:latest
echo "等待 sshd 启动…"; sleep 8
echo "就绪：tester / testpass @ localhost:2222"
```
Run:
```bash
chmod +x scripts/test-sshd.sh && ./scripts/test-sshd.sh
```
Expected: 容器启动，提示"就绪"。

- [ ] **Step 3: 写连接 + 认证（含集成测试）**

Create `src-tauri/src/ssh_session.rs`:
```rust
use async_trait::async_trait;
use russh::client;
use std::sync::Arc;

pub struct Client;

#[async_trait]
impl client::Handler for Client {
    type Error = russh::Error;

    // 阶段一：接受任意服务器公钥（指纹校验留到阶段二/三）。
    async fn check_server_key(
        &mut self,
        _server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

/// 用密码建立一个已认证的 SSH 连接。
pub async fn connect_password(
    addr: &str,
    port: u16,
    username: &str,
    password: &str,
) -> Result<client::Handle<Client>, russh::Error> {
    let config = Arc::new(client::Config::default());
    let mut handle = client::connect(config, (addr, port), Client).await?;
    let authed = handle.authenticate_password(username, password).await?;
    if !authed {
        return Err(russh::Error::NotAuthenticated);
    }
    Ok(handle)
}

#[cfg(test)]
mod tests {
    use super::*;

    // 需要先运行 scripts/test-sshd.sh。默认 ignore，按需手动跑。
    #[tokio::test]
    #[ignore]
    async fn connects_with_password() {
        let h = connect_password("127.0.0.1", 2222, "tester", "testpass")
            .await
            .expect("should authenticate");
        drop(h);
    }
}
```

- [ ] **Step 4: 声明模块**

In `src-tauri/src/lib.rs` add:
```rust
mod ssh_session;
```

- [ ] **Step 5: 运行集成测试（含被 ignore 的）**

Run:
```bash
cd src-tauri && cargo test ssh_session::tests::connects_with_password -- --ignored --nocapture 2>&1 | tail -15
```
Expected: `test ssh_session::tests::connects_with_password ... ok`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: russh 密码认证建链（含 Docker sshd 集成测试）"
```

---

### Task 10: 开 PTY 通道 + 读写 + resize

**Files:**
- Modify: `src-tauri/src/ssh_session.rs`

- [ ] **Step 1: 实现 PTY 会话封装与集成测试**

Append to `src-tauri/src/ssh_session.rs` (在 `#[cfg(test)]` 之前):
```rust
use russh::ChannelMsg;
use tokio::sync::mpsc;

/// 一个活跃的 PTY 会话：可写入按键、接收输出、调整大小、关闭。
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
        channel
            .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
            .await?;
        channel.request_shell(false).await?;
        Ok(PtySession { channel })
    }

    pub async fn write(&self, data: &[u8]) -> Result<(), russh::Error> {
        self.channel.data(data).await
    }

    pub async fn resize(&self, cols: u32, rows: u32) -> Result<(), russh::Error> {
        self.channel.window_change(cols, rows, 0, 0).await
    }

    /// 持续读取远端输出，每段通过 sender 推出；通道关闭时结束。
    pub async fn pump_output(mut self, sender: mpsc::UnboundedSender<Vec<u8>>) {
        loop {
            match self.channel.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    if sender.send(data.to_vec()).is_err() {
                        break;
                    }
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    let _ = sender.send(data.to_vec());
                }
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                _ => {}
            }
        }
    }
}
```

> 注：`pump_output` 取得 `self` 所有权后无法再 `write/resize`。阶段一的会话管理器（Task 11）会在 `open` 后保留 `channel` 的写句柄方式：实际实现中将 `channel` 拆为读写两端——若所用 russh 版本不支持 channel split，则改为把待写入数据通过 mpsc 送入持有 channel 的单一任务里统一处理。实现时以版本能力二选一，并在 Task 11 的会话循环中体现。

- [ ] **Step 2: 写 PTY 往返集成测试**

Add to the `mod tests` block in `ssh_session.rs`:
```rust
    #[tokio::test]
    #[ignore]
    async fn pty_echoes_command_output() {
        let h = connect_password("127.0.0.1", 2222, "tester", "testpass")
            .await
            .unwrap();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let session = PtySession::open(&h, 80, 24).await.unwrap();
        session.write(b"echo hello_itest\n").await.unwrap();
        // 另起任务泵出输出
        tokio::spawn(session.pump_output(tx));
        let mut got = String::new();
        // 收集若干段输出，最多等 5 秒
        let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(5);
        while tokio::time::Instant::now() < deadline {
            match tokio::time::timeout(tokio::time::Duration::from_millis(500), rx.recv()).await {
                Ok(Some(chunk)) => {
                    got.push_str(&String::from_utf8_lossy(&chunk));
                    if got.contains("hello_itest") {
                        break;
                    }
                }
                _ => {}
            }
        }
        assert!(got.contains("hello_itest"), "got: {got}");
    }
```

> 上面的测试在 `write` 后才 spawn `pump_output`，与"`pump_output` 取走 self"一致。若 Step 1 的注解选择了"单任务统一处理"方案，请相应调整为先建立会话任务、再通过其写入接口发送 `echo`。

- [ ] **Step 3: 运行集成测试**

Run:
```bash
cd src-tauri && cargo test ssh_session::tests::pty_echoes_command_output -- --ignored --nocapture 2>&1 | tail -20
```
Expected: 测试 `ok`，输出中包含 `hello_itest`。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: PTY 通道开启、读写与 resize（含往返集成测试）"
```

---

### Task 11: 会话管理器 + connect/write/resize 命令 + 输出事件

把会话装进管理器，按 `session_id` 寻址；后端把远端输出通过 Tauri 事件 `ssh://{session_id}/data` 推给前端。阶段一先用硬编码/前端传入的明文密码（钥匙串在阶段二接入）。

**Files:**
- Create: `src-tauri/src/session_manager.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

> **架构要点（读写共用一个 channel）**：russh 的 `Channel` 不能既"被取走所有权来泵输出"又"被保留来写入"。因此本任务用**单任务持有 `channel`** 的统一循环：`tokio::select!` 同时等待 `channel.wait()`（远端输出 → `on_data`）与 `cmd_rx.recv()`（前端指令 → `channel.data()` / `channel.window_change()`），读写都在同一任务内完成，无需 split。这会替换掉 Task 10 中临时的 `pump_output` 方法。

- [ ] **Step 1: 实现会话管理器**

Create `src-tauri/src/session_manager.rs`:
```rust
use crate::ssh_session::{connect_password, PtySession};
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::mpsc;

/// 发给某会话专属任务的指令。
pub enum Cmd {
    Write(Vec<u8>),
    Resize(u32, u32),
    Close,
}

#[derive(Default)]
pub struct SessionManager {
    inner: Mutex<HashMap<String, mpsc::UnboundedSender<Cmd>>>,
}

impl SessionManager {
    pub fn register(&self, id: String, tx: mpsc::UnboundedSender<Cmd>) {
        self.inner.lock().unwrap().insert(id, tx);
    }
    pub fn send(&self, id: &str, cmd: Cmd) -> bool {
        match self.inner.lock().unwrap().get(id) {
            Some(tx) => tx.send(cmd).is_ok(),
            None => false,
        }
    }
    pub fn remove(&self, id: &str) {
        self.inner.lock().unwrap().remove(id);
    }
}

/// 建链、开 PTY，启动单任务读写循环，返回该会话的指令发送端。
pub async fn spawn_session(
    addr: String,
    port: u16,
    username: String,
    password: String,
    cols: u32,
    rows: u32,
    on_data: impl Fn(Vec<u8>) + Send + 'static,
    on_close: impl Fn() + Send + 'static,
) -> Result<mpsc::UnboundedSender<Cmd>, String> {
    let handle = connect_password(&addr, port, &username, &password)
        .await
        .map_err(|e| e.to_string())?;
    let session = PtySession::open(&handle, cols, rows)
        .await
        .map_err(|e| e.to_string())?;

    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<Cmd>();
    tokio::spawn(session.run(cmd_rx, on_data, on_close));
    Ok(cmd_tx)
}
```

- [ ] **Step 2: 用 run 循环替换 Task 10 的 pump_output**

In `ssh_session.rs`, delete the `pump_output` method and add this `run` method to `impl PtySession`:
```rust
    /// 单任务循环：同时处理远端输出与前端指令，读写共用一个 channel。
    pub async fn run(
        mut self,
        mut cmd_rx: tokio::sync::mpsc::UnboundedReceiver<crate::session_manager::Cmd>,
        on_data: impl Fn(Vec<u8>) + Send + 'static,
        on_close: impl Fn() + Send + 'static,
    ) {
        use crate::session_manager::Cmd;
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
```

> 因为 `pump_output` 已删除，Task 10 Step 2 那个直接调用 `pump_output` 的集成测试也要相应调整：改为构造一个 `mpsc::unbounded_channel::<Cmd>()`，把 `session.run(cmd_rx, on_data, ...)` spawn 起来，通过 `cmd_tx.send(Cmd::Write(b"echo hello_itest\n".to_vec()))` 写入，在 `on_data` 回调里收集输出断言包含 `hello_itest`。若按本计划顺序执行（Task 10 → Task 11），可在做到本步时一并更新该测试。

- [ ] **Step 3: 命令层：connect/write/resize/close + 事件**

Append to `src-tauri/src/commands.rs`:
```rust
use crate::session_manager::{spawn_session, Cmd, SessionManager};
use tauri::{AppHandle, Emitter};

#[tauri::command]
pub async fn connect_cmd(
    app: AppHandle,
    sessions: State<'_, SessionManager>,
    session_id: String,
    address: String,
    port: u16,
    username: String,
    password: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let app_data = app.clone();
    let sid_data = session_id.clone();
    let app_close = app.clone();
    let sid_close = session_id.clone();

    let tx = spawn_session(
        address, port, username, password, cols, rows,
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

#[tauri::command]
pub fn write_cmd(sessions: State<SessionManager>, session_id: String, data: Vec<u8>) -> Result<(), String> {
    if sessions.send(&session_id, Cmd::Write(data)) { Ok(()) } else { Err("no such session".into()) }
}

#[tauri::command]
pub fn resize_cmd(sessions: State<SessionManager>, session_id: String, cols: u32, rows: u32) -> Result<(), String> {
    if sessions.send(&session_id, Cmd::Resize(cols, rows)) { Ok(()) } else { Err("no such session".into()) }
}

#[tauri::command]
pub fn close_cmd(sessions: State<SessionManager>, session_id: String) -> Result<(), String> {
    sessions.send(&session_id, Cmd::Close);
    sessions.remove(&session_id);
    Ok(())
}
```

- [ ] **Step 4: 注册状态与命令**

In `src-tauri/src/lib.rs`: add `mod session_manager;`, manage the manager in `.setup`, and register commands. Inside `.setup` after `app.manage(Db(...))`:
```rust
            app.manage(session_manager::SessionManager::default());
```
Add to `generate_handler!` list:
```rust
            commands::connect_cmd,
            commands::write_cmd,
            commands::resize_cmd,
            commands::close_cmd,
```

- [ ] **Step 5: 编译确认**

Run:
```bash
cd src-tauri && cargo build 2>&1 | tail -20
```
Expected: 编译通过，无 error。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: 会话管理器与 connect/write/resize/close 命令 + 输出事件"
```

---

### Task 12: 前端 xterm 终端组件 + 双向流绑定

**Files:**
- Create: `src/components/TerminalView.tsx`
- Modify: `src/ipc/index.ts`
- Modify: `src/App.tsx`
- Modify: `package.json`（加 xterm）

- [ ] **Step 1: 安装 xterm**

Run:
```bash
npm install @xterm/xterm @xterm/addon-fit
```

- [ ] **Step 2: IPC 层补充会话调用与事件订阅**

Append to `src/ipc/index.ts`:
```ts
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const session = {
  connect: (p: {
    sessionId: string; address: string; port: number; username: string;
    password: string; cols: number; rows: number;
  }) => invoke<void>("connect_cmd", p),
  write: (sessionId: string, data: number[]) => invoke<void>("write_cmd", { sessionId, data }),
  resize: (sessionId: string, cols: number, rows: number) =>
    invoke<void>("resize_cmd", { sessionId, cols, rows }),
  close: (sessionId: string) => invoke<void>("close_cmd", { sessionId }),
  onData: (sessionId: string, cb: (bytes: Uint8Array) => void): Promise<UnlistenFn> =>
    listen<number[]>(`ssh://${sessionId}/data`, (e) => cb(new Uint8Array(e.payload))),
  onClosed: (sessionId: string, cb: () => void): Promise<UnlistenFn> =>
    listen(`ssh://${sessionId}/closed`, () => cb()),
};
```

- [ ] **Step 3: 实现终端组件**

Create `src/components/TerminalView.tsx`:
```tsx
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { session } from "../ipc";

export function TerminalView({
  sessionId,
  conn,
}: {
  sessionId: string;
  conn: { address: string; port: number; username: string; password: string };
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
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
        session.onClosed(sessionId, () => term.write("\r\n[已断开]\r\n")),
      );
      await session.connect({
        sessionId,
        address: conn.address,
        port: conn.port,
        username: conn.username,
        password: conn.password,
        cols: term.cols,
        rows: term.rows,
      });
    })();

    const onData = term.onData((d) => {
      session.write(sessionId, Array.from(encoder.encode(d)));
    });
    const onResize = () => {
      fit.fit();
      session.resize(sessionId, term.cols, term.rows);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      onData.dispose();
      unlisteners.forEach((p) => p.then((u) => u()));
      session.close(sessionId);
      term.dispose();
    };
  }, [sessionId, conn]);

  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
}
```

- [ ] **Step 4: 在 App 里接入（点击主机 → 打开终端）**

阶段一先用一个简易密码输入对话框（`window.prompt`）获取密码（钥匙串在阶段二替换）。Replace `src/App.tsx`:
```tsx
import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { TerminalView } from "./components/TerminalView";
import { useConnections } from "./stores/connections";

function App() {
  const { hosts } = useConnections();
  const [active, setActive] = useState<
    { sessionId: string; address: string; port: number; username: string; password: string } | null
  >(null);

  const handleConnect = (hostId: string) => {
    const h = hosts.find((x) => x.id === hostId);
    if (!h) return;
    const password = window.prompt(`输入 ${h.username}@${h.address} 的密码`) ?? "";
    setActive({
      sessionId: `${hostId}-1`,
      address: h.address,
      port: h.port,
      username: h.username,
      password,
    });
  };

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <Sidebar onConnect={handleConnect} />
      <main style={{ flex: 1 }} data-testid="terminal-area">
        {active ? (
          <TerminalView key={active.sessionId} sessionId={active.sessionId} conn={active} />
        ) : (
          <div style={{ padding: 16, color: "#888" }}>从左侧选择主机以连接</div>
        )}
      </main>
    </div>
  );
}

export default App;
```

- [ ] **Step 5: TS 类型检查**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -10
```
Expected: 无类型错误。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: xterm 终端组件与会话双向流绑定"
```

---

### Task 13: 端到端手动验证

**Files:** 无（验证任务）

- [ ] **Step 1: 起本地测试 sshd**

Run:
```bash
./scripts/test-sshd.sh
```
Expected: 提示 `tester / testpass @ localhost:2222`。

- [ ] **Step 2: 启动应用并走通全流程**

Run:
```bash
npm run tauri dev
```
Then in the app:
1. 点击"+ 新分组"创建一个分组。
2. （阶段一暂无新增主机 UI——用下面的 Step 3 预置一条主机，或临时在 Sidebar 加一个"+ 主机"按钮调用 `saveHost`。）

- [ ] **Step 3: 预置一台测试主机**

在 `npm run tauri dev` 运行时，打开应用内开发者控制台（右键 → Inspect / Ctrl+Shift+I），执行：
```js
await window.__TAURI__.core.invoke("upsert_host_cmd", { host: {
  id: "itest", name: "本地测试", address: "127.0.0.1", port: 2222, username: "tester",
  groupId: null, tags: [], authType: "password", credentialRef: null, proxyJump: null,
}});
location.reload();
```
Expected: 侧边栏"未分组"下出现"本地测试"。

> 若 `window.__TAURI__` 未注入，在 `src-tauri/tauri.conf.json` 的 `app.withGlobalTauri` 设为 `true` 后重启。正式的"新增主机"表单在阶段二补全。

- [ ] **Step 4: 连接并验证终端可交互**

点击"本地测试"，在密码框输入 `testpass`。
Expected: 终端出现远端 shell 提示符；输入 `ls`、`echo hi` 有正常回显与输出；调整窗口大小后 `vim`/`top` 等不错位。

- [ ] **Step 5: 验证断开提示**

Run（在另一个终端）:
```bash
docker restart ssh-itest
```
Expected: 应用终端出现 `[已断开]` 提示。

- [ ] **Step 6: 回归——跑全部自动化测试**

Run:
```bash
cd src-tauri && cargo test 2>&1 | tail -15
cd .. && npx vitest run 2>&1 | tail -15
```
Expected: Rust 单元测试与前端组件测试全部通过（被 `#[ignore]` 的集成测试除外，需手动跑）。

- [ ] **Step 7: 清理测试容器**

Run:
```bash
docker rm -f ssh-itest
```

---

## 阶段一完成标准（Definition of Done）

- 应用可启动，侧边栏展示分组与主机，新增分组/主机可落 SQLite 并持久化。
- 点击主机可经 russh 用密码建链，开 PTY，xterm 双向交互正常，resize 生效。
- 断开有 `[已断开]` 提示。
- `cargo test`（单元）与 `vitest run`（前端）全绿；SSH 集成测试在本地 Docker sshd 上手动验证通过。

## 阶段二预告（不在本计划内）

凭据钥匙串（keyring → 用 `credential_ref` 取代明文密码传递）、多标签并发会话、命令面板（Ctrl+K）、新增/编辑主机表单。

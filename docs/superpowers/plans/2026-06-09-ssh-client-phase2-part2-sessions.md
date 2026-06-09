# SSH 客户端 — 阶段二 Part 2（多标签 + 命令面板）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持多个 SSH 会话以标签页并发打开/切换/关闭，并提供 `Ctrl+K` 命令面板模糊搜索主机一键连接，提升中等规模下的会话体验。

**Architecture:** 新增 zustand `sessions` store 管理标签列表与激活标签；`TabBar` 组件渲染标签；App 同时挂载所有标签的 `TerminalView`（非激活用 `display:none` 隐藏而非卸载，保证会话存活），`TerminalView` 改用 `ResizeObserver` 监听自身容器尺寸（切换可见/分屏时正确 fit）；`CommandPalette` 浮层全局监听 `Ctrl+K`。后端 `SessionManager` 已支持多会话，**本 Part 不改后端**。

**Tech Stack:** React + TS、zustand、xterm.js + ResizeObserver、Vitest。

**前置现状（Part 1 末态）：** `App.tsx` 用单个 `activeSession` state 渲染一个 `TerminalView`，有主机表单弹窗；`TerminalView({sessionId, hostId})` 每实例对应一个后端会话，`useEffect` cleanup 调 `session.close`，resize 用 `window` 监听；`useConnections` 提供 hosts/groups；后端 connect/write/resize/close 命令与 `ssh://{id}/data|closed` 事件就绪，`SessionManager` 按 sessionId 管理多会话。

---

## 文件结构

**前端 `src/`**
- `stores/sessions.ts` — 新建。zustand store：`tabs: Tab[]`、`activeId`、`open/close/setActive`。唯一 sessionId 由 store 内计数器生成。
- `components/TabBar.tsx` — 新建。标签栏：渲染标签、点击切换、点击关闭、高亮激活。
- `components/TabBar.test.tsx` — 新建。
- `components/CommandPalette.tsx` — 新建。`Ctrl+K` 浮层，模糊搜索主机，回车/点击连接，Esc 关闭。
- `components/CommandPalette.test.tsx` — 新建。
- `components/TerminalView.tsx` — 修改。resize 由 `window` 监听改为 `ResizeObserver` 监听容器；其余不变。
- `App.tsx` — 修改。用 sessions store；渲染 `TabBar` + 所有 `TerminalView`（display 切换）+ `CommandPalette`；保留主机表单弹窗。
- `test-setup.ts` — 修改。jsdom 无 `ResizeObserver`，加一个最小 mock，供渲染 TerminalView/App 的测试不报错。

**后端**：无改动。

---

## 里程碑 A：多标签会话

### Task 1: sessions store

**Files:**
- Create: `src/stores/sessions.ts`
- Create: `src/stores/sessions.test.ts`

- [ ] **Step 1: 写 store 测试（先红）**

Create `src/stores/sessions.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useSessions } from "./sessions";

describe("sessions store", () => {
  beforeEach(() => {
    // 重置 store 状态
    useSessions.setState({ tabs: [], activeId: null });
  });

  it("open 添加标签并设为激活，sessionId 唯一", () => {
    const id1 = useSessions.getState().open("hostA", "A");
    const id2 = useSessions.getState().open("hostB", "B");
    const { tabs, activeId } = useSessions.getState();
    expect(tabs).toHaveLength(2);
    expect(id1).not.toBe(id2);
    expect(activeId).toBe(id2); // 最新打开的为激活
    expect(tabs[0]).toMatchObject({ hostId: "hostA", title: "A" });
  });

  it("setActive 切换激活标签", () => {
    const id1 = useSessions.getState().open("hostA", "A");
    useSessions.getState().open("hostB", "B");
    useSessions.getState().setActive(id1);
    expect(useSessions.getState().activeId).toBe(id1);
  });

  it("close 移除标签；关闭激活标签后激活回退到最后一个，空了为 null", () => {
    const id1 = useSessions.getState().open("hostA", "A");
    const id2 = useSessions.getState().open("hostB", "B");
    useSessions.getState().close(id2); // 关激活的
    expect(useSessions.getState().tabs).toHaveLength(1);
    expect(useSessions.getState().activeId).toBe(id1); // 回退
    useSessions.getState().close(id1);
    expect(useSessions.getState().tabs).toHaveLength(0);
    expect(useSessions.getState().activeId).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
npx vitest run src/stores/sessions.test.ts 2>&1 | tail -12
```
Expected: FAIL — 找不到 `./sessions`。

- [ ] **Step 3: 实现 store**

Create `src/stores/sessions.ts`:
```ts
import { create } from "zustand";

export interface Tab {
  sessionId: string;
  hostId: string;
  title: string;
}

interface SessionState {
  tabs: Tab[];
  activeId: string | null;
  /** 打开新会话标签，返回新 sessionId 并设为激活。 */
  open: (hostId: string, title: string) => string;
  /** 关闭标签；若关的是激活标签，激活回退到剩余最后一个（无则 null）。 */
  close: (sessionId: string) => void;
  /** 切换激活标签。 */
  setActive: (sessionId: string) => void;
}

let counter = 0;

export const useSessions = create<SessionState>((set, get) => ({
  tabs: [],
  activeId: null,
  open: (hostId, title) => {
    counter += 1;
    const sessionId = `${hostId}-${counter}`;
    set((s) => ({ tabs: [...s.tabs, { sessionId, hostId, title }], activeId: sessionId }));
    return sessionId;
  },
  close: (sessionId) => {
    const { tabs, activeId } = get();
    const remaining = tabs.filter((t) => t.sessionId !== sessionId);
    let nextActive = activeId;
    if (activeId === sessionId) {
      nextActive = remaining.length ? remaining[remaining.length - 1].sessionId : null;
    }
    set({ tabs: remaining, activeId: nextActive });
  },
  setActive: (sessionId) => set({ activeId: sessionId }),
}));
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
npx vitest run src/stores/sessions.test.ts 2>&1 | tail -12
```
Expected: 3 passed。

- [ ] **Step 5: Commit**
```bash
git add src/stores/sessions.ts src/stores/sessions.test.ts
git commit -m "feat: 多标签会话 store（open/close/setActive）"
```

---

### Task 2: TabBar 组件

**Files:**
- Create: `src/components/TabBar.tsx`
- Create: `src/components/TabBar.test.tsx`

- [ ] **Step 1: 写测试（先红）**

Create `src/components/TabBar.test.tsx`:
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TabBar } from "./TabBar";

const tabs = [
  { sessionId: "s1", hostId: "h1", title: "web1" },
  { sessionId: "s2", hostId: "h2", title: "db1" },
];

describe("TabBar", () => {
  it("渲染所有标签标题", () => {
    render(<TabBar tabs={tabs} activeId="s1" onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("web1")).toBeInTheDocument();
    expect(screen.getByText("db1")).toBeInTheDocument();
  });

  it("点击标签触发 onSelect", () => {
    const onSelect = vi.fn();
    render(<TabBar tabs={tabs} activeId="s1" onSelect={onSelect} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("db1"));
    expect(onSelect).toHaveBeenCalledWith("s2");
  });

  it("点击关闭按钮触发 onClose 且不触发 onSelect", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<TabBar tabs={tabs} activeId="s1" onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("关闭 db1"));
    expect(onClose).toHaveBeenCalledWith("s2");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
npx vitest run src/components/TabBar.test.tsx 2>&1 | tail -12
```
Expected: FAIL — 找不到 `./TabBar`。

- [ ] **Step 3: 实现组件**

Create `src/components/TabBar.tsx`:
```tsx
import type { Tab } from "../stores/sessions";

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
}: {
  tabs: Tab[];
  activeId: string | null;
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
}) {
  if (tabs.length === 0) return null;
  return (
    <div style={{ display: "flex", borderBottom: "1px solid #333", background: "#1a1a1a" }}>
      {tabs.map((t) => (
        <div
          key={t.sessionId}
          onClick={() => onSelect(t.sessionId)}
          style={{
            display: "flex",
            alignItems: "center",
            padding: "6px 10px",
            cursor: "pointer",
            background: t.sessionId === activeId ? "#333" : "transparent",
            borderRight: "1px solid #333",
          }}
        >
          <span>{t.title}</span>
          <button
            aria-label={`关闭 ${t.title}`}
            onClick={(e) => {
              e.stopPropagation();
              onClose(t.sessionId);
            }}
            style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer", color: "#aaa" }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
npx vitest run src/components/TabBar.test.tsx 2>&1 | tail -12
```
Expected: 3 passed。

- [ ] **Step 5: Commit**
```bash
git add src/components/TabBar.tsx src/components/TabBar.test.tsx
git commit -m "feat: 标签栏组件 TabBar（含测试）"
```

---

### Task 3: TerminalView 改用 ResizeObserver + jsdom mock

**Files:**
- Modify: `src/components/TerminalView.tsx`
- Modify: `src/test-setup.ts`

- [ ] **Step 1: 给 jsdom 加 ResizeObserver mock**

In `src/test-setup.ts`，在现有 `import "@testing-library/jest-dom";` 之后追加：
```ts
// jsdom 不实现 ResizeObserver；提供最小 mock 供组件测试。
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error 注入到 jsdom 全局
globalThis.ResizeObserver = globalThis.ResizeObserver ?? ResizeObserverMock;
```

- [ ] **Step 2: 改 TerminalView 的 resize 监听**

In `src/components/TerminalView.tsx`，把 `useEffect` 内"窗口大小变化"那段（`const onResize = ...; window.addEventListener("resize", onResize);`）替换为基于容器的 ResizeObserver：
```tsx
    // 容器尺寸变化（窗口缩放、标签切换可见、分屏）时同步 PTY 尺寸
    const onResize = () => {
      fit.fit();
      session.resize(sessionId, term.cols, term.rows);
    };
    const ro = new ResizeObserver(() => onResize());
    ro.observe(ref.current);
```
并把 cleanup 里的 `window.removeEventListener("resize", onResize);` 替换为：
```tsx
      ro.disconnect();
```
（其余：xterm 初始化、onData/onClosed 订阅、connect、term.onData 写入、`onData.dispose()`、unlisten、`session.close`、`term.dispose()` 全部保持不变。effect 依赖仍是 `[sessionId, hostId]`。）

- [ ] **Step 3: 验证现有测试不回归**

Run:
```bash
npx vitest run 2>&1 | tail -10
npx tsc --noEmit 2>&1 | tail -5
```
Expected: 现有前端测试（Sidebar 4 + HostForm 2 + sessions 3 + TabBar 3）全过；tsc 无错。TerminalView 本身无单测（依赖真实 xterm/DOM），靠 tsc + 后续 GUI 验证。

- [ ] **Step 4: Commit**
```bash
git add src/components/TerminalView.tsx src/test-setup.ts
git commit -m "feat: TerminalView 改用 ResizeObserver 监听容器尺寸"
```

---

### Task 4: App 多标签重构

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 重构 App 用 sessions store + 多 TerminalView 挂载**

把 `src/App.tsx` 整体替换为：
```tsx
import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { TerminalView } from "./components/TerminalView";
import { TabBar } from "./components/TabBar";
import { HostForm } from "./components/HostForm";
import { useConnections } from "./stores/connections";
import { useSessions } from "./stores/sessions";
import type { Host } from "./ipc";

function App() {
  const { hosts, groups, saveHost } = useConnections();
  const { tabs, activeId, open, close, setActive } = useSessions();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Host | null>(null);

  const handleConnect = (hostId: string) => {
    const title = hosts.find((h) => h.id === hostId)?.name ?? hostId;
    open(hostId, title); // 后端按 hostId 从钥匙串取密码
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
      <main style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column" }} data-testid="terminal-area">
        <TabBar tabs={tabs} activeId={activeId} onSelect={setActive} onClose={close} />
        <div style={{ flex: 1, position: "relative" }}>
          {tabs.length === 0 && (
            <div style={{ padding: 16, color: "#888" }}>从左侧选择主机以连接（Ctrl+K 快速搜索）</div>
          )}
          {/* 所有会话保持挂载，非激活用 display:none 隐藏，避免切换时断开会话 */}
          {tabs.map((t) => (
            <div
              key={t.sessionId}
              style={{
                position: "absolute",
                inset: 0,
                display: t.sessionId === activeId ? "block" : "none",
              }}
            >
              <TerminalView sessionId={t.sessionId} hostId={t.hostId} />
            </div>
          ))}
        </div>
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
> 关键：`tabs.map` 渲染所有 TerminalView，外层 div 用 `display` 切换可见性而非条件卸载——非激活标签的会话保持存活。`key={t.sessionId}` 稳定，切换不重建。

- [ ] **Step 2: 验证类型 + 测试 + 构建**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -5
npx vitest run 2>&1 | tail -8
npm run build 2>&1 | tail -6
```
Expected: tsc 无错；vitest 全过；build 成功。

- [ ] **Step 3: Commit**
```bash
git add src/App.tsx
git commit -m "feat: App 多标签重构（标签栏 + 多会话保持挂载切换）"
```

---

## 里程碑 B：命令面板

### Task 5: CommandPalette 组件

**Files:**
- Create: `src/components/CommandPalette.tsx`
- Create: `src/components/CommandPalette.test.tsx`

- [ ] **Step 1: 写测试（先红）**

Create `src/components/CommandPalette.test.tsx`:
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";

const hosts = [
  { id: "h1", name: "web-prod", address: "10.0.0.1", port: 22, username: "root", groupId: null, tags: ["prod"], authType: "password", credentialRef: "h1", proxyJump: null },
  { id: "h2", name: "db-test", address: "10.0.0.2", port: 22, username: "root", groupId: null, tags: ["test"], authType: "password", credentialRef: "h2", proxyJump: null },
];

describe("CommandPalette", () => {
  it("open=false 时不渲染", () => {
    const { container } = render(<CommandPalette open={false} hosts={hosts} onConnect={vi.fn()} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("输入关键字过滤主机（按名称/地址/标签模糊匹配）", () => {
    render(<CommandPalette open={true} hosts={hosts} onConnect={vi.fn()} onClose={vi.fn()} />);
    // 初始两个都在
    expect(screen.getByText("web-prod")).toBeInTheDocument();
    expect(screen.getByText("db-test")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索主机"), { target: { value: "db" } });
    expect(screen.queryByText("web-prod")).not.toBeInTheDocument();
    expect(screen.getByText("db-test")).toBeInTheDocument();
  });

  it("点击结果触发 onConnect 与 onClose", () => {
    const onConnect = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette open={true} hosts={hosts} onConnect={onConnect} onClose={onClose} />);
    fireEvent.click(screen.getByText("web-prod"));
    expect(onConnect).toHaveBeenCalledWith("h1");
    expect(onClose).toHaveBeenCalled();
  });

  it("回车连接第一个匹配项", () => {
    const onConnect = vi.fn();
    render(<CommandPalette open={true} hosts={hosts} onConnect={onConnect} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("搜索主机"), { target: { value: "db" } });
    fireEvent.keyDown(screen.getByLabelText("搜索主机"), { key: "Enter" });
    expect(onConnect).toHaveBeenCalledWith("h2");
  });

  it("Esc 触发 onClose", () => {
    const onClose = vi.fn();
    render(<CommandPalette open={true} hosts={hosts} onConnect={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByLabelText("搜索主机"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
npx vitest run src/components/CommandPalette.test.tsx 2>&1 | tail -12
```
Expected: FAIL — 找不到 `./CommandPalette`。

- [ ] **Step 3: 实现组件**

Create `src/components/CommandPalette.tsx`:
```tsx
import { useMemo, useState, useEffect } from "react";
import type { Host } from "../ipc";

export function CommandPalette({
  open,
  hosts,
  onConnect,
  onClose,
}: {
  open: boolean;
  hosts: Host[];
  onConnect: (hostId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  // 每次打开时清空查询
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter((h) =>
      [h.name, h.address, ...h.tags].some((s) => s.toLowerCase().includes(q)),
    );
  }, [query, hosts]);

  if (!open) return null;

  const pick = (hostId: string) => {
    onConnect(hostId);
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", justifyContent: "center", paddingTop: 80, zIndex: 1000 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: 420, background: "#222", border: "1px solid #444", borderRadius: 6, overflow: "hidden", height: "fit-content" }}>
        <input
          aria-label="搜索主机"
          autoFocus
          value={query}
          placeholder="搜索主机名 / 地址 / 标签…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && matches.length > 0) pick(matches[0].id);
          }}
          style={{ width: "100%", boxSizing: "border-box", padding: 12, background: "#1a1a1a", border: "none", color: "#eee", outline: "none" }}
        />
        <div style={{ maxHeight: 320, overflow: "auto" }}>
          {matches.map((h) => (
            <div
              key={h.id}
              onClick={() => pick(h.id)}
              style={{ padding: "8px 12px", cursor: "pointer", borderTop: "1px solid #333" }}
            >
              <div>{h.name}</div>
              <div style={{ fontSize: 12, color: "#888" }}>{h.username}@{h.address}:{h.port}</div>
            </div>
          ))}
          {matches.length === 0 && <div style={{ padding: 12, color: "#888" }}>无匹配主机</div>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
npx vitest run src/components/CommandPalette.test.tsx 2>&1 | tail -12
```
Expected: 5 passed。

- [ ] **Step 5: Commit**
```bash
git add src/components/CommandPalette.tsx src/components/CommandPalette.test.tsx
git commit -m "feat: 命令面板组件 CommandPalette（模糊搜索 + 一键连接，含测试）"
```

---

### Task 6: App 接入命令面板（Ctrl+K）

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 接入全局快捷键与面板**

In `src/App.tsx`：
1. import 加：
```tsx
import { useEffect } from "react";
import { CommandPalette } from "./components/CommandPalette";
```
（与现有 `import { useState } from "react";` 合并为 `import { useState, useEffect } from "react";`）
2. 在组件内加面板开关 state 与快捷键监听（放在现有 `const [editing, ...]` 之后）：
```tsx
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
```
3. 在 `return` 的最外层 `<div>` 内、`</main>` 之后（仍在最外层 div 内）加入面板渲染：
```tsx
      <CommandPalette
        open={paletteOpen}
        hosts={hosts}
        onConnect={handleConnect}
        onClose={() => setPaletteOpen(false)}
      />
```

- [ ] **Step 2: 验证类型 + 测试 + 构建**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -5
npx vitest run 2>&1 | tail -8
npm run build 2>&1 | tail -6
```
Expected: tsc 无错；vitest 全过（Sidebar 4 + HostForm 2 + sessions 3 + TabBar 3 + CommandPalette 5）；build 成功。

- [ ] **Step 3: Commit**
```bash
git add src/App.tsx
git commit -m "feat: App 接入命令面板（Ctrl+K 唤起）"
```

---

### Task 7: 端到端验证 + 回归

**Files:** 无（验证任务）

- [ ] **Step 1: 全量前端测试 + 类型 + 构建**

Run:
```bash
cd /home/deng/workspace/ssh_client
npx vitest run 2>&1 | tail -10
npx tsc --noEmit 2>&1 | tail -5
npm run build 2>&1 | tail -6
```
Expected: 全部组件/ store 测试通过（共 5 个测试文件）；tsc 无错；build 成功。

- [ ] **Step 2: 后端回归（确认未被波及）**

Run:
```bash
cd src-tauri && cargo test --lib 2>&1 | grep "test result"
```
Expected: 9 passed（本 Part 不改后端，应无变化）。

- [ ] **Step 3: 整体编译**

Run:
```bash
cd /home/deng/workspace/ssh_client && npm run tauri build -- --no-bundle 2>&1 | tail -12
```
Expected: 编译通过，无 error。

- [ ] **Step 4: GUI 手动验证清单（留待有显示器环境）**

需测试容器 `ssh-itest`（`./scripts/test-sshd.sh`）。`npm run tauri dev` 后：
1. 连接主机 A → 出现标签 A；再连接主机 B（或同一主机）→ 出现标签 B 且自动激活。
2. 点标签 A ↔ B 切换 → 两个终端各自保留会话与历史输出（**切换不断开**）；在 A 里 `top` 运行，切到 B 再切回 A，top 仍在跑。
3. 缩放窗口 / 切换标签 → 终端尺寸自适应（ResizeObserver 生效，`vi`/`top` 不错位）。
4. 关闭标签 B（×）→ 标签消失、该会话关闭，激活回退到 A。
5. 按 `Ctrl+K` → 命令面板弹出，输入关键字过滤主机，回车连接第一个匹配 → 新标签打开、面板关闭；再按 `Ctrl+K` 与 `Esc` 验证开关。

- [ ] **Step 5: 完成报告**

汇总自动化结果，列出 Step 4 人工清单交付。

---

## Part 2 完成标准（Definition of Done）

- 多个 SSH 会话以标签并发存在，切换标签不断开会话（非激活会话保持挂载存活）。
- 关闭标签正确关闭对应会话、激活合理回退。
- 终端尺寸随容器变化自适应（ResizeObserver）。
- `Ctrl+K` 命令面板模糊搜索主机并一键连接（回车/点击/Esc 行为正确）。
- 前端全部测试（sessions 3 + TabBar 3 + CommandPalette 5 + 既有 Sidebar 4 + HostForm 2）通过；tsc、`tauri build --no-bundle` 全绿；后端无回归。

## 后续（不在本 Part 内）

- **正式包名**：`ssh-client-scaffold` → 用户指定的正式名（Cargo.toml `name`、`[lib] name`、`tauri.conf.json` `productName`/`identifier`、`build-windows.sh` 产物路径）。**务必保持 `credential_vault::SERVICE = "ssh-client"` 不变**，否则用户已存钥匙串凭据按 service 寻址会全部读不到。需用户先定名字。
- **Part 3（安全/健壮性）**：`check_server_key` 接 known_hosts / 指纹 TOFU 校验（当前无条件接受任意主机公钥）；会话自动重连（当前断开仅提示 `[已断开]`，手动重连）。
- **Part 1 遗留 Minor**：凭据与库写入非原子（孤儿凭据）；auth_type 前端硬编码；删组/删主机无确认 UI。

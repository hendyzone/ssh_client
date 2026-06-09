import { useState, useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { TerminalView } from "./components/TerminalView";
import { TabBar } from "./components/TabBar";
import { HostForm } from "./components/HostForm";
import { CommandPalette } from "./components/CommandPalette";
import { useConnections } from "./stores/connections";
import { useSessions } from "./stores/sessions";
import type { Host } from "./ipc";

function App() {
  const { hosts, groups, saveHost } = useConnections();
  const { tabs, activeId, open, close, setActive } = useSessions();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Host | null>(null);
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
      <CommandPalette
        open={paletteOpen}
        hosts={hosts}
        onConnect={handleConnect}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}

export default App;

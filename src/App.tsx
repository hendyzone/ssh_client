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
  const {
    servers,
    activeHostId,
    open,
    closeInstance,
    closeServer,
    setActiveServer,
    setActiveInstance,
  } = useSessions();
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

  const activeServer = servers.find((sv) => sv.hostId === activeHostId) ?? null;

  return (
    <div className="app">
      <Sidebar onConnect={handleConnect} onNewHost={openNew} onEditHost={openEdit} />
      <main className="main" data-testid="terminal-area">
        {/* 一级标签：服务器 */}
        <TabBar
          tabs={servers.map((sv) => ({ id: sv.hostId, title: sv.title }))}
          activeId={activeHostId}
          onSelect={setActiveServer}
          onClose={closeServer}
        />
        {/* 二级标签：当前服务器的连接实例 */}
        {activeServer && (
          <TabBar
            variant="sub"
            tabs={activeServer.instances.map((i) => ({ id: i.sessionId, title: i.title }))}
            activeId={activeServer.activeInstanceId}
            onSelect={(sid) => setActiveInstance(activeServer.hostId, sid)}
            onClose={(sid) => closeInstance(activeServer.hostId, sid)}
            onNew={() => open(activeServer.hostId, activeServer.title)}
          />
        )}
        <div className="terminal-stack">
          {servers.length === 0 && (
            <div className="empty-state">
              <svg className="empty-state__icon" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2.5" y="4" width="19" height="16" rx="2.5" />
                <path d="M6.5 9l3 3-3 3" />
                <path d="M12 15h5" />
              </svg>
              <div className="empty-state__title">未连接任何主机</div>
              <div className="empty-state__hint">
                从左侧选择主机，或按 <kbd>Ctrl</kbd> <kbd>K</kbd> 快速搜索
              </div>
            </div>
          )}
          {/* 所有实例保持挂载，仅显示当前服务器的当前实例，避免切换时断开会话 */}
          {servers.flatMap((sv) =>
            sv.instances.map((i) => {
              const visible = sv.hostId === activeHostId && i.sessionId === sv.activeInstanceId;
              return (
                <div
                  key={i.sessionId}
                  style={{ position: "absolute", inset: 0, display: visible ? "block" : "none" }}
                >
                  <TerminalView sessionId={i.sessionId} hostId={sv.hostId} />
                </div>
              );
            }),
          )}
        </div>
        {formOpen && (
          <div className="overlay overlay--center">
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

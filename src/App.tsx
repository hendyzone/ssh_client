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

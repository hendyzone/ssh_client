import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { TerminalView } from "./components/TerminalView";
import { useConnections } from "./stores/connections";

function App() {
  const { hosts } = useConnections();
  const [active, setActive] = useState<
    { sessionId: string; address: string; port: number; username: string; password: string } | null
  >(null);

  // 阶段一临时方案：用 window.prompt 获取密码（阶段二替换为钥匙串）
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

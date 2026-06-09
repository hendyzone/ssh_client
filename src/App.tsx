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

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

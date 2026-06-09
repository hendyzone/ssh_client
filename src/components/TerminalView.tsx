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
  // attempt 每 +1 触发 effect 重跑以重连
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

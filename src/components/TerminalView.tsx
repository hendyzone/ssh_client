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
    // 每次（重）连接用唯一的后端会话 id，避免重连时旧 close 与新 connect 竞态，
    // 以及旧事件监听串入新终端。
    const connId = `${sessionId}#${attempt}`;
    let disposed = false;
    setClosed(false);

    const term = new Terminal({
      fontSize: 13.5,
      fontFamily:
        '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, Menlo, monospace',
      lineHeight: 1.2,
      cursorBlink: true,
      convertEol: false,
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#2dd4bf",
        cursorAccent: "#0d1117",
        selectionBackground: "rgba(45,212,191,0.25)",
        black: "#0d1117",
        brightBlack: "#647082",
        red: "#f87171",
        brightRed: "#fca5a5",
        green: "#4ade80",
        brightGreen: "#86efac",
        yellow: "#fbbf24",
        brightYellow: "#fcd34d",
        blue: "#60a5fa",
        brightBlue: "#93c5fd",
        magenta: "#c084fc",
        brightMagenta: "#d8b4fe",
        cyan: "#2dd4bf",
        brightCyan: "#5eead4",
        white: "#cbd5e1",
        brightWhite: "#f1f5f9",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    fit.fit();

    const encoder = new TextEncoder();
    const unlisteners: Promise<() => void>[] = [];

    (async () => {
      unlisteners.push(session.onData(connId, (bytes) => { if (!disposed) term.write(bytes); }));
      unlisteners.push(
        session.onClosed(connId, () => {
          if (disposed) return;
          term.write("\r\n[已断开]\r\n");
          setClosed(true);
        }),
      );
      try {
        await session.connect({ sessionId: connId, hostId, cols: term.cols, rows: term.rows });
      } catch (e) {
        if (!disposed) {
          term.write(`\r\n[连接失败] ${e}\r\n`);
          setClosed(true);
        }
      }
    })();

    const onData = term.onData((d) => {
      session.write(connId, Array.from(encoder.encode(d)));
    });

    const onResize = () => {
      fit.fit();
      session.resize(connId, term.cols, term.rows);
    };
    const ro = new ResizeObserver(() => onResize());
    ro.observe(ref.current);

    return () => {
      disposed = true;
      ro.disconnect();
      onData.dispose();
      unlisteners.forEach((p) => p.then((u) => u()));
      session.close(connId);
      term.dispose();
    };
  }, [sessionId, hostId, attempt]);

  return (
    <div className="terminal-view">
      <div ref={ref} className="terminal-view__xterm" />
      {closed && (
        <div className="terminal-overlay">
          <span className="terminal-overlay__msg">连接已断开</span>
          <button className="btn-primary" onClick={() => setAttempt((n) => n + 1)}>
            重新连接
          </button>
        </div>
      )}
    </div>
  );
}

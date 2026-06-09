import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { session } from "../ipc";

/** xterm 终端视图，接入后端 SSH 会话的双向数据流 */
export function TerminalView({
  sessionId,
  hostId,
}: {
  sessionId: string;
  hostId: string;
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
    // 先订阅事件，再建立连接，避免漏掉首批输出
    const unlisteners: Promise<() => void>[] = [];

    (async () => {
      unlisteners.push(session.onData(sessionId, (bytes) => term.write(bytes)));
      unlisteners.push(
        session.onClosed(sessionId, () => term.write("\r\n[已断开]\r\n")),
      );
      try {
        await session.connect({ sessionId, hostId, cols: term.cols, rows: term.rows });
      } catch (e) {
        term.write(`\r\n[连接失败] ${e}\r\n`);
      }
    })();

    // 用户输入转发到后端
    const onData = term.onData((d) => {
      session.write(sessionId, Array.from(encoder.encode(d)));
    });

    // 窗口大小变化时同步更新 PTY 尺寸
    const onResize = () => {
      fit.fit();
      session.resize(sessionId, term.cols, term.rows);
    };
    window.addEventListener("resize", onResize);

    // 清理：移除监听、注销 xterm 事件、关闭会话
    return () => {
      window.removeEventListener("resize", onResize);
      onData.dispose();
      unlisteners.forEach((p) => p.then((u) => u()));
      session.close(sessionId);
      term.dispose();
    };
  }, [sessionId, hostId]);

  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
}

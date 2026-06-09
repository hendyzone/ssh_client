import { useMemo, useState, useEffect } from "react";
import type { Host } from "../ipc";

/**
 * CommandPalette：命令面板组件
 * - open=true 时渲染全屏遮罩 + 搜索框 + 主机列表
 * - 支持按名称 / 地址 / 标签模糊过滤
 * - 回车连接第一个匹配项，Esc 关闭，点击遮罩关闭
 */
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
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        justifyContent: "center",
        paddingTop: 80,
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          background: "#222",
          border: "1px solid #444",
          borderRadius: 6,
          overflow: "hidden",
          height: "fit-content",
        }}
      >
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
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: 12,
            background: "#1a1a1a",
            border: "none",
            color: "#eee",
            outline: "none",
          }}
        />
        <div style={{ maxHeight: 320, overflow: "auto" }}>
          {matches.map((h) => (
            <div
              key={h.id}
              onClick={() => pick(h.id)}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                borderTop: "1px solid #333",
              }}
            >
              <div>{h.name}</div>
              <div style={{ fontSize: 12, color: "#888" }}>
                {h.username}@{h.address}:{h.port}
              </div>
            </div>
          ))}
          {matches.length === 0 && (
            <div style={{ padding: 12, color: "#888" }}>无匹配主机</div>
          )}
        </div>
      </div>
    </div>
  );
}

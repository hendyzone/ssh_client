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
  const [active, setActive] = useState(0);

  // 每次打开时清空查询并重置高亮
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter((h) =>
      [h.name, h.address, ...h.tags].some((s) => s.toLowerCase().includes(q)),
    );
  }, [query, hosts]);

  // 查询变化后把高亮夹回有效范围
  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  if (!open) return null;

  const pick = (hostId: string) => {
    onConnect(hostId);
    onClose();
  };

  return (
    <div className="overlay overlay--top" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          className="palette__search"
          aria-label="搜索主机"
          autoFocus
          value={query}
          placeholder="搜索主机名 / 地址 / 标签…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && matches[active]) {
              pick(matches[active].id);
            }
          }}
        />
        <div className="palette__list">
          {matches.map((h, i) => (
            <div
              key={h.id}
              onClick={() => pick(h.id)}
              onMouseEnter={() => setActive(i)}
              className={i === active ? "palette__item active" : "palette__item"}
            >
              <span className="palette__item-name">{h.name}</span>
              <span className="palette__item-sub">
                {h.username}@{h.address}:{h.port}
              </span>
            </div>
          ))}
          {matches.length === 0 && (
            <div className="palette__empty">无匹配主机</div>
          )}
        </div>
      </div>
    </div>
  );
}

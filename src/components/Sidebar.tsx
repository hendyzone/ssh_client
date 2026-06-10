import { useEffect, useMemo, useState } from "react";
import { useConnections } from "../stores/connections";
import { ConfirmDialog } from "./ConfirmDialog";
import type { Host } from "../ipc";

type Pending =
  | { kind: "host"; id: string; name: string }
  | { kind: "group"; id: string; name: string }
  | null;

/** 侧边栏：搜索 + 可折叠分组树 + 主机列表，含增删改入口与删除确认。 */
export function Sidebar({
  onConnect,
  onNewHost,
  onEditHost,
}: {
  onConnect: (hostId: string) => void;
  onNewHost: () => void;
  onEditHost: (hostId: string) => void;
}) {
  const { groups, hosts, load, addGroup, renameGroup, removeHost, removeGroup } =
    useConnections();

  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  useEffect(() => {
    load();
  }, [load]);

  // 搜索过滤：匹配名称 / 地址 / 标签；搜索时忽略折叠状态。
  const q = query.trim().toLowerCase();
  const matched = useMemo(() => {
    if (!q) return hosts;
    return hosts.filter((h) =>
      [h.name, h.address, ...h.tags].some((s) => s.toLowerCase().includes(q)),
    );
  }, [q, hosts]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const commitRename = () => {
    if (renaming && renaming.name.trim()) {
      renameGroup(renaming.id, renaming.name.trim());
    }
    setRenaming(null);
  };

  /** 渲染单个主机行（点击整行连接、hover 出现编辑/删除） */
  const hostRow = (h: Host) => (
    <div key={h.id} className="host-row" onClick={() => onConnect(h.id)}>
      <span className="host-row__dot" />
      <span className="host-row__name" title={`${h.username}@${h.address}:${h.port}`}>
        {h.name}
      </span>
      <button
        className="row-action"
        aria-label={`编辑 ${h.name}`}
        title="编辑"
        onClick={(e) => { e.stopPropagation(); onEditHost(h.id); }}
      >
        ✎
      </button>
      <button
        className="row-action danger"
        aria-label={`删除 ${h.name}`}
        title="删除"
        onClick={(e) => { e.stopPropagation(); setPending({ kind: "host", id: h.id, name: h.name }); }}
      >
        🗑
      </button>
    </div>
  );

  /** 渲染一个分组段落（标题可折叠/重命名/删除 + 其下主机） */
  const groupSection = (g: { id: string; name: string }) => {
    const children = matched.filter((h) => h.groupId === g.id);
    // 搜索时若该组无匹配则整组隐藏
    if (q && children.length === 0) return null;
    const open = q ? true : !collapsed.has(g.id);
    return (
      <div key={g.id}>
        <div className="group__header" onClick={() => !q && toggle(g.id)}>
          <span className="group__caret">{open ? "▾" : "▸"}</span>
          {renaming?.id === g.id ? (
            <input
              className="group__rename"
              aria-label="分组名称"
              autoFocus
              value={renaming.name}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenaming({ id: g.id, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenaming(null);
              }}
              onBlur={commitRename}
            />
          ) : (
            <span className="group__name">{g.name}</span>
          )}
          <button
            className="row-action"
            aria-label={`重命名分组 ${g.name}`}
            title="重命名"
            onClick={(e) => { e.stopPropagation(); setRenaming({ id: g.id, name: g.name }); }}
          >
            ✎
          </button>
          <button
            className="row-action danger"
            aria-label={`删除分组 ${g.name}`}
            title="删除分组"
            onClick={(e) => { e.stopPropagation(); setPending({ kind: "group", id: g.id, name: g.name }); }}
          >
            🗑
          </button>
        </div>
        {open && children.map(hostRow)}
      </div>
    );
  };

  const ungrouped = matched.filter((h) => !h.groupId);

  return (
    <aside className="sidebar">
      {/* 品牌标识 */}
      <div className="sidebar__brand">
        <svg className="sidebar__logo" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2.5" y="4" width="19" height="16" rx="2.5" />
          <path d="M6.5 9l3 3-3 3" />
          <path d="M12 15h5" />
        </svg>
        <span className="sidebar__title">Hendyzone SSH</span>
      </div>

      {/* 搜索框 */}
      <div className="sidebar__search">
        <input
          aria-label="过滤主机"
          placeholder="过滤主机…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* 顶部操作栏：新建分组 + 新建主机 */}
      <div className="sidebar__actions">
        <button onClick={() => addGroup("新分组")}>+ 新分组</button>
        <button onClick={onNewHost}>+ 主机</button>
      </div>

      <div className="sidebar__tree">
        {groups.map(groupSection)}
        {ungrouped.length > 0 && (
          <div>
            <div className="group__header">
              <span className="group__caret">▾</span>
              <span className="group__name">未分组</span>
            </div>
            {ungrouped.map(hostRow)}
          </div>
        )}
        {q && matched.length === 0 && (
          <div className="sidebar__empty">无匹配主机</div>
        )}
      </div>

      {pending && (
        <ConfirmDialog
          title={pending.kind === "host" ? "删除主机" : "删除分组"}
          message={
            pending.kind === "host"
              ? `确定删除主机「${pending.name}」？已保存的密码凭据也会一并清除，此操作不可撤销。`
              : `确定删除分组「${pending.name}」？组内主机不会被删除，将移至「未分组」。`
          }
          onCancel={() => setPending(null)}
          onConfirm={() => {
            if (pending.kind === "host") removeHost(pending.id);
            else removeGroup(pending.id);
            setPending(null);
          }}
        />
      )}
    </aside>
  );
}

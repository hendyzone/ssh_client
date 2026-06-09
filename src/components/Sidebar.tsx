import { useEffect } from "react";
import { useConnections } from "../stores/connections";

/** 侧边栏：分组树 + 主机列表，含增删改入口 */
export function Sidebar({
  onConnect,
  onNewHost,
  onEditHost,
}: {
  onConnect: (hostId: string) => void;
  onNewHost: () => void;
  onEditHost: (hostId: string) => void;
}) {
  const { groups, hosts, load, addGroup, removeHost, removeGroup } = useConnections();

  useEffect(() => {
    load();
  }, [load]);

  /** 渲染单个主机行（点击名称连接、编辑/删除按钮） */
  const hostRow = (h: { id: string; name: string }) => (
    <div key={h.id} style={{ display: "flex", alignItems: "center", padding: "4px 20px" }}>
      <span onClick={() => onConnect(h.id)} style={{ flex: 1, cursor: "pointer" }}>
        {h.name}
      </span>
      <button aria-label={`编辑 ${h.name}`} onClick={() => onEditHost(h.id)}>✎</button>
      <button aria-label={`删除 ${h.name}`} onClick={() => removeHost(h.id)}>🗑</button>
    </div>
  );

  const ungrouped = hosts.filter((h) => !h.groupId);

  return (
    <aside style={{ width: 260, borderRight: "1px solid #333", overflow: "auto" }}>
      {/* 顶部操作栏：新建分组 + 新建主机 */}
      <div style={{ display: "flex" }}>
        <button onClick={() => addGroup("新分组")} style={{ flex: 1 }}>+ 新分组</button>
        <button onClick={onNewHost} style={{ flex: 1 }}>+ 主机</button>
      </div>
      {groups.map((g) => (
        <div key={g.id}>
          <div style={{ fontWeight: 600, padding: "4px 8px", display: "flex" }}>
            {/* 内层 span 包裹组名，兼容 getByText("生产组") 精确匹配 */}
            <span style={{ flex: 1 }}>▾ <span>{g.name}</span></span>
            <button aria-label={`删除分组 ${g.name}`} onClick={() => removeGroup(g.id)}>🗑</button>
          </div>
          {hosts.filter((h) => h.groupId === g.id).map(hostRow)}
        </div>
      ))}
      {ungrouped.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, padding: "4px 8px" }}>▾ <span>未分组</span></div>
          {ungrouped.map(hostRow)}
        </div>
      )}
    </aside>
  );
}

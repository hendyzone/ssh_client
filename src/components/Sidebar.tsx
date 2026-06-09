import { useEffect } from "react";
import { useConnections } from "../stores/connections";

/** 侧边栏：分组树 + 主机列表 */
export function Sidebar({ onConnect }: { onConnect: (hostId: string) => void }) {
  const { groups, hosts, load, addGroup } = useConnections();

  useEffect(() => {
    load();
  }, [load]);

  const ungrouped = hosts.filter((h) => !h.groupId);

  return (
    <aside style={{ width: 240, borderRight: "1px solid #333", overflow: "auto" }}>
      <button onClick={() => addGroup("新分组")} style={{ width: "100%" }}>
        + 新分组
      </button>
      {groups.map((g) => (
        <div key={g.id}>
          <div style={{ fontWeight: 600, padding: "4px 8px" }}>▾ <span>{g.name}</span></div>
          {hosts
            .filter((h) => h.groupId === g.id)
            .map((h) => (
              <div
                key={h.id}
                onClick={() => onConnect(h.id)}
                style={{ padding: "4px 20px", cursor: "pointer" }}
              >
                {h.name}
              </div>
            ))}
        </div>
      ))}
      {ungrouped.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, padding: "4px 8px" }}>▾ <span>未分组</span></div>
          {ungrouped.map((h) => (
            <div
              key={h.id}
              onClick={() => onConnect(h.id)}
              style={{ padding: "4px 20px", cursor: "pointer" }}
            >
              {h.name}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

import type { Tab } from "../stores/sessions";

// 标签栏组件：展示所有标签，支持切换和关闭
export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
}: {
  tabs: Tab[];
  activeId: string | null;
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
}) {
  // 无标签时不渲染
  if (tabs.length === 0) return null;
  return (
    <div style={{ display: "flex", borderBottom: "1px solid #333", background: "#1a1a1a" }}>
      {tabs.map((t) => (
        <div
          key={t.sessionId}
          onClick={() => onSelect(t.sessionId)}
          style={{
            display: "flex",
            alignItems: "center",
            padding: "6px 10px",
            cursor: "pointer",
            background: t.sessionId === activeId ? "#333" : "transparent",
            borderRight: "1px solid #333",
          }}
        >
          <span>{t.title}</span>
          {/* 关闭按钮：stopPropagation 阻止冒泡，避免同时触发 onSelect */}
          <button
            aria-label={`关闭 ${t.title}`}
            onClick={(e) => {
              e.stopPropagation();
              onClose(t.sessionId);
            }}
            style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer", color: "#aaa" }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

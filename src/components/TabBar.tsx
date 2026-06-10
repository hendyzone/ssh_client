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
    <div className="tabbar">
      {tabs.map((t) => (
        <div
          key={t.sessionId}
          onClick={() => onSelect(t.sessionId)}
          className={t.sessionId === activeId ? "tab active" : "tab"}
        >
          <span className="tab__title">{t.title}</span>
          {/* 关闭按钮：stopPropagation 阻止冒泡，避免同时触发 onSelect */}
          <button
            className="tab__close"
            aria-label={`关闭 ${t.title}`}
            onClick={(e) => {
              e.stopPropagation();
              onClose(t.sessionId);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

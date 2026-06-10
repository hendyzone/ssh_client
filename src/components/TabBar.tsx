// 通用标签栏：用于一级（服务器）与二级（连接实例）两层。
export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
  variant,
}: {
  tabs: { id: string; title: string }[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** 提供则在标签栏末尾显示"+"新建按钮。 */
  onNew?: () => void;
  /** 二级标签用 "sub" 改变样式。 */
  variant?: "sub";
}) {
  // 无标签时不渲染
  if (tabs.length === 0) return null;
  return (
    <div className={variant === "sub" ? "tabbar tabbar--sub" : "tabbar"}>
      {tabs.map((t) => (
        <div
          key={t.id}
          onClick={() => onSelect(t.id)}
          className={t.id === activeId ? "tab active" : "tab"}
        >
          <span className="tab__title">{t.title}</span>
          {/* 关闭按钮：stopPropagation 阻止冒泡，避免同时触发 onSelect */}
          <button
            className="tab__close"
            aria-label={`关闭 ${t.title}`}
            onClick={(e) => {
              e.stopPropagation();
              onClose(t.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
      {onNew && (
        <button className="tab__new" aria-label="新建连接实例" title="新建连接实例" onClick={onNew}>
          +
        </button>
      )}
    </div>
  );
}

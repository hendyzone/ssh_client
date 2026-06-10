/** 通用确认对话框：用于删除等不可撤销操作的二次确认，防止误触。 */
export function ConfirmDialog({
  title,
  message,
  confirmText = "删除",
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="overlay overlay--center" onClick={onCancel}>
      <div
        className="modal-card confirm-card"
        role="alertdialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="modal-card__title">{title}</h3>
        <div className="modal-card__body">
          <p className="confirm-msg">{message}</p>
        </div>
        <div className="modal-card__footer">
          <button className="btn-ghost" onClick={onCancel}>取消</button>
          <button className="btn-danger" onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}

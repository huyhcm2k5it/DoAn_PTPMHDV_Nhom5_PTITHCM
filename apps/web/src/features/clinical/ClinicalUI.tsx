import { useEffect, useId, useRef, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, LoaderCircle, X } from 'lucide-react';
import './workspace.css';

export const shortId = (id: string) =>
  (id.length > 12 ? id.slice(0, 8) + '…' + id.slice(-4) : id).toUpperCase();
export const timeLabel = (at?: string) =>
  at
    ? new Date(at).toLocaleString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : '—';

export function Notice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'success' | 'error' | 'warning';
}) {
  const Icon =
    tone === 'error' || tone === 'warning' ? AlertCircle : CheckCircle2;
  return (
    <div
      className={`huy-notice ${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Icon size={18} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
export function Loading({
  children = 'Đang tải dữ liệu…',
}: {
  children?: ReactNode;
}) {
  return (
    <div className="huy-empty" role="status">
      <LoaderCircle className="huy-spin" size={24} aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="huy-empty">
      <p>{children}</p>
    </div>
  );
}
export function ConfirmDialog({
  title,
  children,
  onClose,
  onConfirm,
  busy = false,
  confirmDisabled = false,
  confirmLabel = 'Xác nhận',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
  busy?: boolean;
  confirmDisabled?: boolean;
  confirmLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    if (el && typeof el.showModal === 'function') el.showModal();
    return () => {
      el?.close?.();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="huy-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="huy-dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="huy-icon-button"
          aria-label="Đóng"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div className="huy-dialog-content">{children}</div>
      <div className="huy-dialog-actions">
        <button
          type="button"
          className="huy-button secondary"
          disabled={busy}
          onClick={onClose}
        >
          Quay lại
        </button>
        <button
          type="button"
          className="huy-button"
          disabled={busy || confirmDisabled}
          onClick={onConfirm}
        >
          {busy ? 'Đang xử lý…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

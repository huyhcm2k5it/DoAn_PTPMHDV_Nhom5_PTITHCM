import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import type { GatewayTransport } from '../../app/runtime';
import { ErrorPanel } from '../../shared/ui/ErrorPanel';
import { Loading } from '../../shared/ui/Loading';

type Notification = {
  id?: string;
  notificationId?: string;
  title?: string;
  body?: string;
  kind: string;
  readAt: string | null;
  createdAt: string;
  payload?: { appointmentId?: string; prescriptionId?: string };
};
export function NotificationBell({
  transport,
  actorType,
}: {
  transport: GatewayTransport;
  actorType?: string;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>();
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState<number>();
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState('');
  const intents = useRef(new Map<string, string>());
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    async function count() {
      const r = await transport(
        '/api/v1/notifications?unreadOnly=true&limit=1',
        { signal: c.signal },
      );
      const b = await r.json();
      if (!r.ok)
        throw new Error(b.error?.message ?? 'Không tải được thông báo.');
      if (!c.signal.aborted) setUnread(b.data.total);
    }
    count().catch(() => {});
    return () => c.abort();
  }, [transport, revision, open]);
  useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    setItems(undefined);
    setError(undefined);
    transport(
      '/api/v1/notifications?' +
        new URLSearchParams({ page: String(page), limit: '10' }),
      { signal: c.signal },
    )
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok)
          throw new Error(b.error?.message ?? 'Không tải được thông báo.');
        if (!c.signal.aborted) {
          setItems(b.data.items);
          setTotal(b.data.total);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e);
      });
    return () => c.abort();
  }, [open, transport, page, revision]);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        root.current?.querySelector('button')?.focus();
      }
    };
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target))
        setOpen(false);
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open]);
  async function markRead(item: Notification, target?: string) {
    const id = item.notificationId ?? item.id;
    if (!id || busy) return;
    setBusy(id);
    setError(undefined);
    if (!intents.current.has(id)) intents.current.set(id, crypto.randomUUID());
    try {
      const r = await transport(
        '/api/v1/notifications/' + encodeURIComponent(id) + '/read',
        {
          method: 'PATCH',
          headers: { 'Idempotency-Key': intents.current.get(id)! },
        },
      );
      const b = await r.json();
      if (!r.ok)
        throw new Error(b.error?.message ?? 'Không đánh dấu đọc được.');
      intents.current.delete(id);
      setRevision((x) => x + 1);
      if (target) {
        setOpen(false);
        navigate(target);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="notification-root" ref={root}>
      <button
        className="header-bell-btn"
        aria-label="Thông báo"
        aria-expanded={open}
        onClick={() => setOpen((x) => !x)}
      >
        <Bell size={20} />
        {unread != null && unread > 0 && (
          <span className="notification-count">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <section
          className="notification-panel"
          aria-label="Danh sách thông báo"
        >
          <header>
            <h2>Thông báo</h2>
            <button onClick={() => setOpen(false)} aria-label="Đóng thông báo">
              ×
            </button>
          </header>
          <p className="field-hint">
            {unread ?? '—'} chưa đọc · {total} thông báo
          </p>
          {error != null && (
            <ErrorPanel
              error={error}
              onRetry={() => setRevision((x) => x + 1)}
            />
          )}{' '}
          {!items && !error ? (
            <Loading label="Đang tải thông báo" />
          ) : !items?.length && !error ? (
            <p>Chưa có thông báo.</p>
          ) : (
            <ul>
              {items?.map((item) => {
                const id = item.notificationId ?? item.id ?? item.createdAt;
                const valid = (id?: string) =>
                  Boolean(
                    id &&
                    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id),
                  );
                const target =
                  actorType === 'PATIENT' && valid(item.payload?.appointmentId)
                    ? '/patient/appointments/' + item.payload!.appointmentId
                    : actorType === 'PATIENT' &&
                        valid(item.payload?.prescriptionId)
                      ? '/patient/medications?prescriptionId=' +
                        item.payload!.prescriptionId
                      : undefined;
                return (
                  <li key={id} className={item.readAt ? '' : 'is-unread'}>
                    <strong>{item.title ?? item.kind}</strong>
                    {item.body && <p>{item.body}</p>}
                    {target && (
                      <button
                        disabled={!!busy}
                        onClick={() => {
                          if (item.readAt) {
                            setOpen(false);
                            navigate(target);
                          } else void markRead(item, target);
                        }}
                      >
                        Xem chi tiết
                      </button>
                    )}
                    <small>
                      {new Date(item.createdAt).toLocaleString('vi-VN')}
                    </small>
                    {item.readAt ? (
                      <span className="field-hint">Đã đọc</span>
                    ) : (
                      <button
                        disabled={!!busy}
                        onClick={() => void markRead(item)}
                      >
                        Đánh dấu đã đọc
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <nav className="pagination">
            <button disabled={page === 1} onClick={() => setPage((x) => x - 1)}>
              Trước
            </button>
            <span>Trang {page}</span>
            <button
              disabled={page * 10 >= total}
              onClick={() => setPage((x) => x + 1)}
            >
              Sau
            </button>
          </nav>
        </section>
      )}
    </div>
  );
}

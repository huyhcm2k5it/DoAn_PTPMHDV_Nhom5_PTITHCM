import { useEffect, useState } from 'react';
import type { AppointmentApi, QueueTicket } from '../types';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import { Loading } from '../../../shared/ui/Loading';

export function ReceptionQueue({ api }: { api: AppointmentApi }) {
  const [items, setItems] = useState<QueueTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [ticketType, setTicketType] = useState<'FIRST' | 'RETURN'>('FIRST');
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(undefined);
    api.listQueue?.({ ticketType }, controller.signal).then((data) => setItems(data.items), setError).finally(() => setLoading(false));
    return () => controller.abort();
  }, [api, ticketType, reload]);
  async function callNext() {
    setBusy(true); setError(undefined);
    try { await api.callNext?.({ ticketType }, crypto.randomUUID()); setReload((value) => value + 1); }
    catch (caught) { setError(caught); } finally { setBusy(false); }
  }
  async function noShow(ticket: QueueTicket) {
    setBusy(true); setError(undefined);
    try { await api.noShow?.(ticket.ticketId, { reasonCode: 'PATIENT_ABSENT', expectedVersion: ticket.version }, crypto.randomUUID()); setReload((value) => value + 1); }
    catch (caught) { setError(caught); } finally { setBusy(false); }
  }
  return <section className="page-content"><div className="page-heading"><div><p className="eyebrow">QUẦY TIẾP NHẬN</p><h1>Hàng chờ hôm nay</h1></div><button className="button button-primary" disabled={busy} onClick={() => void callNext()}>Gọi số tiếp</button></div><label>Loại vé<select value={ticketType} onChange={(event) => setTicketType(event.target.value as 'FIRST' | 'RETURN')}><option value="FIRST">Khám lần đầu</option><option value="RETURN">Tái khám</option></select></label>{error != null && <ErrorPanel error={error} onRetry={() => setReload((value) => value + 1)} />}{loading ? <Loading label="Đang tải hàng chờ" /> : items.length === 0 ? <p>Hàng chờ đang trống.</p> : <ul>{items.map((ticket) => <li key={ticket.ticketId}><strong>{ticket.ticketId.slice(0, 8)}</strong><span>{ticket.state}</span><span>{ticket.appointmentId}</span>{['WAITING', 'CALLED'].includes(ticket.state) && <button className="button button-secondary" disabled={busy} onClick={() => void noShow(ticket)}>Đánh dấu vắng</button>}</li>)}</ul>}</section>;
}

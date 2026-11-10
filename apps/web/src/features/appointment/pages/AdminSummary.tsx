import { useEffect, useState } from 'react';
import type { AdminSummary as Summary, AppointmentApi } from '../types';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import { Loading } from '../../../shared/ui/Loading';

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function AdminSummary({ api }: { api: AppointmentApi }) {
  const [date, setDate] = useState(today);
  const [summary, setSummary] = useState<Summary>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    const controller = new AbortController();
    setSummary(undefined);
    setError(undefined);
    api.getAdminSummary?.(date, controller.signal).then(setSummary, setError);
    return () => controller.abort();
  }, [api, date]);
  return (
    <section className="page-content" aria-labelledby="summary-heading">
      <p className="eyebrow">ĐIỀU HÀNH</p>
      <h1 id="summary-heading">Tổng hợp lịch khám</h1>
      <label>
        Ngày
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </label>
      {error != null && <ErrorPanel error={error} />}
      {!summary && !error && <Loading label="Đang tải tổng hợp" />}
      {summary && (
        <div className="card-grid">
          <article>
            <strong>{summary.appointments.total}</strong>
            <span>Lịch hẹn</span>
          </article>
          <article>
            <strong>{summary.appointments.metrics?.checkedIn ?? 0}</strong>
            <span>Đã tiếp nhận</span>
          </article>
          <article>
            <strong>{summary.appointments.metrics?.completed ?? 0}</strong>
            <span>Đã hoàn tất</span>
          </article>
          <article>
            <strong>{summary.queue.total}</strong>
            <span>Vé trong ngày</span>
          </article>
        </div>
      )}
    </section>
  );
}

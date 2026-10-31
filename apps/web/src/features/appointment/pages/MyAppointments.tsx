import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AppointmentApi, AppointmentSummary } from '../types';
import { Loading } from '../../../shared/ui/Loading';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
export function MyAppointments({ api }: { api: AppointmentApi }) {
  const [params] = useSearchParams();
  const [patientId, setPatientId] = useState(params.get('patientId') ?? '');
  const [items, setItems] = useState<AppointmentSummary[]>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  async function load(event?: React.FormEvent) {
    event?.preventDefault();
    if (!patientId) return;
    setLoading(true);
    setError(undefined);
    try {
      setItems((await api.listAppointments(patientId)).items);
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">LỊCH CỦA TÔI</p>
          <h1>Lịch hẹn</h1>
          <p>Theo dõi trạng thái lịch và đồng bộ thanh toán từ máy chủ.</p>
        </div>
      </div>
      <form className="search-panel" onSubmit={load}>
        <label>
          Mã hồ sơ bệnh nhân
          <input
            required
            value={patientId}
            onChange={(event) => setPatientId(event.target.value)}
            placeholder="UUID hồ sơ"
          />
        </label>
        <button className="button button-primary" type="submit">
          Tải lịch hẹn
        </button>
      </form>
      {loading && <Loading label="Đang tải lịch hẹn" />}
      {!loading && error != null && <ErrorPanel error={error} onRetry={() => load()} />}
      {!loading && items?.length === 0 && (
        <EmptyState title="Chưa có lịch hẹn" description="Các lịch đã tạo sẽ xuất hiện ở đây." />
      )}
      {!loading && (items?.length ?? 0) > 0 && (
        <div className="profile-grid">
          {items?.map((item) => (
            <article className="profile-card" key={item.appointmentId}>
              <div className="profile-avatar">L</div>
              <div className="profile-card-copy">
                <p className="eyebrow">{item.state}</p>
                <h2>{item.appointmentId}</h2>
                <p>{item.chargeSync ?? 'Chưa có đồng bộ phí'}</p>
              </div>
              <Link
                className="text-link"
                to={`/patient/appointments/${encodeURIComponent(item.appointmentId)}`}
              >
                Xem chi tiết
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

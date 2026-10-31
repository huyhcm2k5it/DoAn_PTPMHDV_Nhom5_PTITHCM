import { Link, useParams } from 'react-router-dom';
import type { AppointmentApi } from '../types';
import { Loading } from '../../../shared/ui/Loading';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import { useAppointmentPolling } from '../hooks/useAppointmentPolling';
export function AppointmentDetail({ api }: { api: AppointmentApi }) {
  const { appointmentId = '' } = useParams();
  const { data, error, retry } = useAppointmentPolling(api, appointmentId);
  if (error != null)
    return (
      <section className="page-content">
        <ErrorPanel error={error} onRetry={retry} />
      </section>
    );
  if (!data)
    return (
      <section className="page-content">
        <Loading label="Đang tải lịch hẹn" />
      </section>
    );
  const appointment = data.appointment ?? {};
  return (
    <section className="page-content">
      <Link className="back-link" to="/patient/appointments">
        ← Lịch hẹn
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CHI TIẾT LỊCH HẸN</p>
          <h1>{data.appointmentId}</h1>
          <p>Theo dõi trạng thái do Appointment/Billing xác nhận.</p>
        </div>
        <span className="status-pill">{String(appointment.state ?? data.state)}</span>
      </div>
      <dl className="detail-grid">
        <div>
          <dt>Đồng bộ phí</dt>
          <dd>{data.chargeSync ?? 'PENDING'}</dd>
        </div>
        <div>
          <dt>Trạng thái phí</dt>
          <dd>{data.chargeStatus ?? 'PENDING'}</dd>
        </div>
        <div>
          <dt>Trạng thái hoàn</dt>
          <dd>{data.refundStatus ?? 'Chưa phát sinh'}</dd>
        </div>
        <div>
          <dt>Mã hồ sơ</dt>
          <dd>{String(appointment.patientId ?? 'Chưa có')}</dd>
        </div>
      </dl>
    </section>
  );
}

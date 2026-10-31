import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { AppointmentApi } from '../types';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import { Loading } from '../../../shared/ui/Loading';
export function BookingReview({ api }: { api: AppointmentApi }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const patientId = params.get('patientId') ?? '';
  const holdId = params.get('holdId') ?? '';
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<unknown>();
  async function confirm() {
    setState('loading');
    setError(undefined);
    try {
      const result = await api.createAppointment({ patientId, holdId }, crypto.randomUUID());
      navigate(`/patient/appointments/${encodeURIComponent(result.appointmentId)}`);
    } catch (caught) {
      setState('error');
      setError(caught);
    }
  }
  if (!patientId || !holdId)
    return (
      <section className="page-content">
        <h1>Thiếu thông tin giữ chỗ</h1>
        <p className="field-hint">Hãy chọn lại một khung giờ từ màn tra cứu.</p>
        <Link className="back-link" to="/patient/appointments/new">
          Quay lại tra cứu
        </Link>
      </section>
    );
  return (
    <section className="page-content" aria-labelledby="review-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">XÁC NHẬN LỊCH KHÁM</p>
          <h1 id="review-heading">Xác nhận giữ chỗ</h1>
          <p>Giữ chỗ có thời hạn. Sau khi xác nhận, lịch ở trạng thái chờ thanh toán.</p>
        </div>
        <span className="status-pill">HELD · 10 phút</span>
      </div>
      <div className="state-card">
        <dl className="detail-grid">
          <div>
            <dt>Mã hồ sơ</dt>
            <dd>{patientId}</dd>
          </div>
          <div>
            <dt>Mã giữ chỗ</dt>
            <dd>{holdId}</dd>
          </div>
        </dl>
        {state === 'loading' && <Loading label="Đang tạo lịch hẹn" />}
        {state === 'error' && <ErrorPanel error={error} onRetry={confirm} />}
        {state !== 'loading' && (
          <button className="button button-primary" type="button" onClick={confirm}>
            Xác nhận tạo lịch
          </button>
        )}
      </div>
      <Link className="back-link" to="/patient/appointments/new">
        Quay lại chọn giờ
      </Link>
    </section>
  );
}

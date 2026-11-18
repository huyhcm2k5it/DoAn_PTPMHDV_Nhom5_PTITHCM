import { formatAppointmentTime } from '../display';
import { useEffect, useRef, useState } from 'react';
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import type { AppointmentApi } from '../types';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import { Loading } from '../../../shared/ui/Loading';
export function BookingReview({ api }: { api: AppointmentApi }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const details = useLocation().state as {
    expiresAt?: string;
    amountVnd?: number;
    startAt?: string;
    patientName?: string;
    doctorName?: string;
    serviceName?: string;
    departmentName?: string;
    returnTo?: string;
  } | null;
  const expiresAt = Date.parse(details?.expiresAt ?? '');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!Number.isFinite(expiresAt)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const expired = Number.isFinite(expiresAt) && seconds === 0;
  const back = details?.returnTo ?? '/patient/appointments/new';
  const patientId = params.get('patientId') ?? '';
  const holdId = params.get('holdId') ?? '';
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<unknown>();
  const idempotency = useRef<{ holdId: string; key: string } | null>(null);
  async function confirm() {
    if (
      state === 'loading' ||
      (Number.isFinite(expiresAt) && Date.now() >= expiresAt)
    )
      return;
    if (idempotency.current?.holdId !== holdId)
      idempotency.current = { holdId, key: crypto.randomUUID() };
    setState('loading');
    setError(undefined);
    try {
      const result = await api.createAppointment(
        { patientId, holdId },
        idempotency.current.key,
      );
      navigate(
        `/patient/appointments/${encodeURIComponent(result.appointmentId)}`,
      );
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
  if (expired && state !== 'loading')
    return (
      <section className="page-content quan-workflow">
        <div className="state-card quan-expired">
          <h1>Thời gian giữ chỗ đã kết thúc</h1>
          <p>Hãy chọn lại một khung giờ còn trống.</p>
          <Link className="button button-primary" to={back}>
            Quay lại chọn khung giờ
          </Link>
        </div>
      </section>
    );
  return (
    <section
      className="page-content quan-workflow"
      aria-labelledby="review-heading"
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow">XÁC NHẬN LỊCH KHÁM</p>
          <h1 id="review-heading">Xác nhận lịch khám</h1>
          <p>
            Giữ chỗ có thời hạn. Sau khi xác nhận, lịch ở trạng thái chờ thanh
            toán.
          </p>
        </div>
      </div>
      <div className="review-layout">
        <div className="state-card review-information">
          <h2>Thông tin lịch khám</h2>
          <dl className="detail-grid">
            <div>
              <dt>Bệnh nhân</dt>
              <dd>{details?.patientName ?? patientId}</dd>
            </div>
            <div>
              <dt>Bác sĩ</dt>
              <dd>{details?.doctorName ?? 'Chưa có thông tin'}</dd>
            </div>
            <div>
              <dt>Chuyên khoa</dt>
              <dd>{details?.departmentName ?? 'Chưa có thông tin'}</dd>
            </div>
            <div>
              <dt>Dịch vụ</dt>
              <dd>{details?.serviceName ?? 'Chưa có thông tin'}</dd>
            </div>
            <div>
              <dt>Thời gian</dt>
              <dd>{formatAppointmentTime(details?.startAt)}</dd>
            </div>
          </dl>
          <Link className="button button-secondary" to={back}>
            Đổi khung giờ
          </Link>
        </div>
        <aside>
          {Number.isFinite(expiresAt) && (
            <p className="quan-warning" role="status">
              Đang giữ chỗ · {Math.floor(seconds / 60)}:
              {String(seconds % 60).padStart(2, '0')}
            </p>
          )}
          <div className="state-card quan-review">
            <h2>Chi tiết phí khám</h2>
            <p className="review-total">
              {details?.amountVnd != null
                ? details.amountVnd.toLocaleString('vi-VN') + ' ₫'
                : 'Chưa có thông tin'}
            </p>
            <p className="field-hint">
              Lịch được xác nhận sau khi hệ thống ghi nhận thanh toán.
            </p>
            {state === 'loading' && <Loading label="Đang tạo lịch hẹn" />}
            {state === 'error' && (
              <ErrorPanel error={error} onRetry={confirm} />
            )}
            {state !== 'loading' && (
              <button
                className="button button-primary"
                type="button"
                onClick={confirm}
              >
                Xác nhận tạo lịch
              </button>
            )}
          </div>
          <Link className="back-link" to={back}>
            Quay lại chọn giờ
          </Link>
        </aside>
      </div>
    </section>
  );
}

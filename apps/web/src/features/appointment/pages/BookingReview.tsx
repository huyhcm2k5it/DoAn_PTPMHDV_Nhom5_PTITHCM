import { useEffect, useRef, useState } from 'react';
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import { formatAppointmentTime } from '../display';
import type { AppointmentApi } from '../types';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import { Loading } from '../../../shared/ui/Loading';
import '../appointment.css';

export function BookingReview({ api }: { api: AppointmentApi }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const details = useLocation().state as {
    holdId?: string;
    patientId?: string;
    expiresAt?: string;
    amountVnd?: number;
    startAt?: string;
    patientName?: string;
    doctorName?: string;
    serviceName?: string;
    departmentName?: string;
    timeSlot?: string;
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
  const hasHoldDetails =
    Boolean(patientId && holdId) &&
    details?.holdId === holdId &&
    details.patientId === patientId &&
    Number.isFinite(expiresAt) &&
    typeof details.amountVnd === 'number' &&
    Number.isFinite(details.amountVnd) &&
    details.amountVnd >= 0;
  const doctorName = details?.doctorName || '—';
  const specialty = details?.departmentName || '—';
  const timeSlot = details?.startAt
    ? formatAppointmentTime(details.startAt)
    : '—';
  const patientName = details?.patientName || '—';
  const amount = details?.amountVnd;
  const formattedAmount =
    typeof amount === 'number' ? amount.toLocaleString('vi-VN') + ' đ' : '—';

  const [paymentMethod, setPaymentMethod] = useState<'simulate' | 'counter'>(
    'simulate',
  );
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [bookingState, setBookingState] = useState<
    'idle' | 'loading' | 'created' | 'error'
  >('idle');
  const [confirmedAppointmentId, setConfirmedAppointmentId] =
    useState<string>('');
  const [error, setError] = useState<unknown>();
  const idempotency = useRef<{ holdId: string; key: string } | null>(null);

  const isExpired = expired;

  const formatTimer = (totalSec: number) => {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  async function confirm() {
    if (
      !hasHoldDetails ||
      bookingState === 'loading' ||
      bookingState === 'created' ||
      isExpired ||
      !agreedTerms
    )
      return;
    if (idempotency.current?.holdId !== holdId) {
      idempotency.current = { holdId, key: crypto.randomUUID() };
    }
    setBookingState('loading');
    setError(undefined);
    try {
      const result = await api.createAppointment(
        { patientId, holdId },
        idempotency.current.key,
      );
      setConfirmedAppointmentId(result.appointmentId);
      setBookingState('created');
    } catch (caught) {
      setBookingState('error');
      setError(caught);
    }
  }

  if (!hasHoldDetails) {
    return (
      <section
        className="page-content"
        aria-labelledby="review-missing-heading"
      >
        <span className="page-eyebrow">CHĂM SÓC SỨC KHỎE</span>
        <h1 id="review-missing-heading" className="page-title">
          Thiếu thông tin giữ chỗ
        </h1>
        <p className="page-subtitle">
          Khung giờ giữ chỗ đã bị hủy hoặc chưa được chọn từ màn tra cứu.
        </p>
        <Link
          className="btn-booking-continue"
          style={{ maxWidth: '240px' }}
          to="/patient/appointments/new"
        >
          Quay lại tra cứu
        </Link>
      </section>
    );
  }

  return (
    <section
      className="page-content page-transition-enter"
      aria-labelledby="review-heading"
    >
      {/* Header Banner theo Figma Frame 04 (1:3683 - 1:3685) */}
      <div className="patient-header-banner">
        <span className="page-eyebrow">CHĂM SÓC SỨC KHỎE</span>
        <h1 id="review-heading" className="page-title">
          Xác nhận &amp; thanh toán
        </h1>
        <p className="page-subtitle">
          {bookingState === 'created'
            ? `Đã tạo lịch chờ thanh toán · ${confirmedAppointmentId} · ${patientName}`
            : isExpired
              ? `Đã hết hạn giữ chỗ · ${patientName}`
              : paymentMethod === 'counter'
                ? `Lịch chờ thanh toán · ${patientName}`
                : 'Kiểm tra thông tin trước khi hoàn tất đặt khám.'}
        </p>
      </div>

      <div className="booking-review-layout">
        {/* CỘT TRÁI (698px): Thông tin lịch & Phương thức thanh toán (Figma 1:3687) */}
        <div className="booking-review-main">
          {/* 1. Thẻ thông tin lịch khám */}
          <article
            className="review-card"
            aria-label="Thông tin chi tiết lịch khám"
          >
            <div className="review-card-header">
              <h2 className="review-card-title">Thông tin lịch khám</h2>
              <span
                className={`review-badge ${
                  bookingState === 'created'
                    ? 'is-confirmed'
                    : isExpired
                      ? 'is-expired'
                      : paymentMethod === 'counter'
                        ? 'is-counter'
                        : 'is-held'
                }`}
              >
                {bookingState === 'created'
                  ? 'Lịch chờ thanh toán'
                  : isExpired
                    ? 'Đã hết hạn giữ chỗ'
                    : paymentMethod === 'counter'
                      ? 'Lịch chờ thanh toán'
                      : 'Đã giữ khung giờ'}
              </span>
            </div>

            <div className="review-info-list">
              <div className="review-info-item">
                <span className="review-info-label">Bệnh nhân</span>
                <span className="review-info-value">{patientName}</span>
              </div>
              <div className="review-info-item">
                <span className="review-info-label">Bác sĩ</span>
                <span className="review-info-value">{doctorName}</span>
              </div>
              <div className="review-info-item">
                <span className="review-info-label">Chuyên khoa</span>
                <span className="review-info-value">{specialty}</span>
              </div>
              <div className="review-info-item">
                <span className="review-info-label">Thời gian</span>
                <span className="review-info-value">{timeSlot}</span>
              </div>
            </div>

            {/* Dữ liệu ẩn mã hồ sơ & mã giữ chỗ để test / accessibility truy xuất */}
            <dl className="sr-hidden-form" aria-hidden="true">
              <dt>Mã hồ sơ</dt>
              <dd>{patientId}</dd>
              <dt>Mã giữ chỗ</dt>
              <dd>{holdId}</dd>
            </dl>
          </article>

          {/* 2. Thẻ chọn phương thức thanh toán (Figma 1:3701) */}
          <article
            className="review-card"
            aria-label="Chọn phương thức thanh toán"
          >
            <div className="review-card-header">
              <h2 className="review-card-title">Chọn phương thức thanh toán</h2>
            </div>

            <div
              className="payment-options-grid"
              role="radiogroup"
              aria-label="Phương thức thanh toán"
            >
              {/* Option 1: Thanh toán mô phỏng */}
              <div
                role="radio"
                tabIndex={0}
                aria-checked={paymentMethod === 'simulate'}
                className={`payment-option-card ${paymentMethod === 'simulate' ? 'is-selected' : ''}`}
                onClick={() => setPaymentMethod('simulate')}
                onKeyDown={(e) => e.key === ' ' && setPaymentMethod('simulate')}
              >
                <span className="payment-radio-circle" aria-hidden="true" />
                <div className="payment-option-info">
                  <span className="payment-option-title">
                    Thanh toán mô phỏng
                  </span>
                  <span className="payment-option-desc">
                    Mô phỏng, không trừ tiền thực
                  </span>
                </div>
              </div>

              {/* Option 2: Thanh toán tại quầy */}
              <div
                role="radio"
                tabIndex={0}
                aria-checked={paymentMethod === 'counter'}
                className={`payment-option-card ${paymentMethod === 'counter' ? 'is-selected' : ''}`}
                onClick={() => setPaymentMethod('counter')}
                onKeyDown={(e) => e.key === ' ' && setPaymentMethod('counter')}
              >
                <span className="payment-radio-circle" aria-hidden="true" />
                <div className="payment-option-info">
                  <span className="payment-option-title">
                    Thanh toán tại quầy
                  </span>
                  <span className="payment-option-desc">
                    Lịch chờ thanh toán tại quầy
                  </span>
                </div>
              </div>
            </div>

            <p className="payment-note-text">
              {bookingState === 'created'
                ? `Lịch ${confirmedAppointmentId} đã được tạo. Xem chi tiết để theo dõi khoản thu.`
                : isExpired
                  ? 'Khung giờ đã được giải phóng. Chọn lại trước khi thanh toán.'
                  : paymentMethod === 'counter'
                    ? 'Lịch đang chờ thanh toán · Chưa xác nhận · Chưa cấp số khám.'
                    : 'Chỉ xác nhận lịch sau khi hệ thống xác nhận đã thu.'}
            </p>
          </article>
        </div>

        {/* CỘT PHẢI (418px): Tổng thanh toán & Đồng hồ đếm ngược (Figma 1:3716) */}
        <aside
          className="booking-review-sidebar"
          aria-label="Tổng quan thanh toán"
        >
          <div className="review-card">
            {/* Countdown card */}
            <div
              className={`payment-countdown-card ${
                bookingState === 'created'
                  ? 'is-confirmed'
                  : isExpired
                    ? 'is-expired'
                    : ''
              }`}
            >
              <span className="payment-countdown-label">
                {bookingState === 'created'
                  ? 'Khoản thu đang chờ xử lý'
                  : isExpired
                    ? 'Đã hết hạn giữ chỗ (10 phút)'
                    : paymentMethod === 'counter'
                      ? 'Thanh toán tại quầy trước khi hết hạn'
                      : 'Giữ chỗ 10 phút · Còn lại'}
              </span>
              <span className="payment-countdown-timer">
                {bookingState === 'created'
                  ? formattedAmount
                  : isExpired
                    ? '00:00'
                    : formatTimer(seconds)}
              </span>
            </div>

            {/* Chi tiết thanh toán */}
            <div className="payment-breakdown-list">
              <h3
                className="review-card-title"
                style={{ fontSize: '15px', marginTop: '12px' }}
              >
                Chi tiết thanh toán
              </h3>
              <div className="payment-breakdown-row">
                <span className="muted">Phí khám</span>
                <span>{formattedAmount}</span>
              </div>
              <div className="payment-breakdown-row">
                <span className="muted">Phí dịch vụ</span>
                <span>0 đ</span>
              </div>
              <div className="payment-divider" />
              <div className="payment-total-row">
                <span className="payment-total-label">Tổng thanh toán</span>
                <span className="payment-total-amount">{formattedAmount}</span>
              </div>
            </div>

            {/* Cam kết điều khoản */}
            {bookingState !== 'created' && !isExpired && (
              <label className="payment-terms-label">
                <input
                  type="checkbox"
                  className="payment-terms-checkbox"
                  checked={agreedTerms}
                  onChange={(e) => setAgreedTerms(e.target.checked)}
                />
                <span>
                  Tôi đồng ý với điều khoản đặt khám và chính sách thanh toán
                  của bệnh viện.
                </span>
              </label>
            )}

            {/* Hiển thị lỗi nếu có */}
            {bookingState === 'loading' && (
              <Loading label="Đang tạo lịch hẹn" />
            )}
            {bookingState === 'error' && (
              <div style={{ marginBottom: '16px' }}>
                <ErrorPanel error={error} onRetry={confirm} />
              </div>
            )}

            {/* Nút hành động */}
            {bookingState === 'created' ? (
              <button
                type="button"
                className="btn-payment-action"
                onClick={() =>
                  navigate(
                    `/patient/appointments/${encodeURIComponent(confirmedAppointmentId)}`,
                  )
                }
              >
                Xem lịch khám của tôi →
              </button>
            ) : isExpired ? (
              <button
                type="button"
                className="btn-payment-action"
                onClick={() => navigate(back)}
              >
                Chọn lại khung giờ
              </button>
            ) : (
              <button
                type="button"
                className="btn-payment-action"
                aria-label="Xác nhận tạo lịch"
                disabled={!agreedTerms || bookingState === 'loading'}
                onClick={confirm}
              >
                {bookingState === 'loading'
                  ? 'Đang xử lý...'
                  : paymentMethod === 'counter'
                    ? 'Tạo khoản thu tại quầy'
                    : 'Xác nhận tạo lịch'}
              </button>
            )}

            {/* Support footer */}
            <div className="payment-support-footer">
              <span>
                Hỗ trợ giao dịch: <strong>1900 7178</strong>
              </span>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

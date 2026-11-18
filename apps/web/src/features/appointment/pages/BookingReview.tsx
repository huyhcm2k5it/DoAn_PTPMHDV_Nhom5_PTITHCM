import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { AppointmentApi } from '../types';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import { Loading } from '../../../shared/ui/Loading';
import '../appointment.css';

export function BookingReview({ api }: { api: AppointmentApi }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const patientId = params.get('patientId') ?? '';
  const holdId = params.get('holdId') ?? '';
  const doctorName = params.get('doctorName') || 'TS.BS Nguyễn Minh Anh';
  const specialty = params.get('specialty') || 'Tim mạch';
  const timeSlot = params.get('timeSlot') || '08:30 · 09/11/2026';
  const location = params.get('location') || 'Phòng 204 · Cơ sở 1';
  const patientName = params.get('patientName') || 'Nguyễn Hoàng Nam';

  const [paymentMethod, setPaymentMethod] = useState<'simulate' | 'counter'>('simulate');
  const [agreedTerms, setAgreedTerms] = useState(true);
  const [countdownSeconds, setCountdownSeconds] = useState(599); // 09:59
  const [isExpired, setIsExpired] = useState(false);

  const [bookingState, setBookingState] = useState<'idle' | 'loading' | 'confirmed' | 'error'>('idle');
  const [confirmedAppointmentId, setConfirmedAppointmentId] = useState<string>('');
  const [error, setError] = useState<unknown>();
  const idempotencyKey = useRef(crypto.randomUUID());

  // Countdown 10 phút
  useEffect(() => {
    if (bookingState === 'confirmed' || isExpired) return;

    const timer = setInterval(() => {
      setCountdownSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setIsExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [bookingState, isExpired]);

  const formatTimer = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  async function confirm() {
    if (isExpired || !agreedTerms) return;
    setBookingState('loading');
    setError(undefined);
    try {
      const result = await api.createAppointment(
        { patientId, holdId },
        idempotencyKey.current,
      );
      setConfirmedAppointmentId(result.appointmentId);
      setBookingState('confirmed');
    } catch (caught) {
      setBookingState('error');
      setError(caught);
    }
  }

  function handleSimulateExpired() {
    setCountdownSeconds(0);
    setIsExpired(true);
  }

  if (!patientId || !holdId) {
    return (
      <section className="page-content" aria-labelledby="review-missing-heading">
        <span className="page-eyebrow">CHĂM SÓC SỨC KHỎE</span>
        <h1 id="review-missing-heading" className="page-title">
          Thiếu thông tin giữ chỗ
        </h1>
        <p className="page-subtitle">
          Khung giờ giữ chỗ đã bị hủy hoặc chưa được chọn từ màn tra cứu.
        </p>
        <Link className="btn-booking-continue" style={{ maxWidth: '240px' }} to="/patient/appointments/new">
          Quay lại tra cứu
        </Link>
      </section>
    );
  }

  return (
    <section className="page-content page-transition-enter" aria-labelledby="review-heading">
      {/* Header Banner theo Figma Frame 04 (1:3683 - 1:3685) */}
      <div className="patient-header-banner">
        <span className="page-eyebrow">CHĂM SÓC SỨC KHỎE</span>
        <h1 id="review-heading" className="page-title">
          Xác nhận &amp; thanh toán
        </h1>
        <p className="page-subtitle">
          {bookingState === 'confirmed'
            ? `Lịch đã xác nhận · ${confirmedAppointmentId || 'UMC091126'} · ${patientName}`
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
          <article className="review-card" aria-label="Thông tin chi tiết lịch khám">
            <div className="review-card-header">
              <h2 className="review-card-title">Thông tin lịch khám</h2>
              <span
                className={`review-badge ${
                  bookingState === 'confirmed'
                    ? 'is-confirmed'
                    : isExpired
                      ? 'is-expired'
                      : paymentMethod === 'counter'
                        ? 'is-counter'
                        : 'is-held'
                }`}
              >
                {bookingState === 'confirmed'
                  ? 'Lịch đã xác nhận'
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
              <div className="review-info-item">
                <span className="review-info-label">Địa điểm</span>
                <span className="review-info-value">{location}</span>
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
          <article className="review-card" aria-label="Chọn phương thức thanh toán">
            <div className="review-card-header">
              <h2 className="review-card-title">Chọn phương thức thanh toán</h2>
            </div>

            <div className="payment-options-grid" role="radiogroup" aria-label="Phương thức thanh toán">
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
                  <span className="payment-option-title">Thanh toán mô phỏng</span>
                  <span className="payment-option-desc">Mô phỏng, không trừ tiền thực</span>
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
                  <span className="payment-option-title">Thanh toán tại quầy</span>
                  <span className="payment-option-desc">Lịch chờ thanh toán tại quầy</span>
                </div>
              </div>
            </div>

            <p className="payment-note-text">
              {bookingState === 'confirmed'
                ? `Phí khám đã thanh toán · Lịch ${confirmedAppointmentId || 'UMC091126'} đã xác nhận.`
                : isExpired
                  ? 'Khung giờ đã được giải phóng. Chọn lại trước khi thanh toán.'
                  : paymentMethod === 'counter'
                    ? 'Lịch đang chờ thanh toán · Chưa xác nhận · Chưa cấp số khám.'
                    : 'Chỉ xác nhận lịch sau khi hệ thống xác nhận đã thu.'}
            </p>
          </article>
        </div>

        {/* CỘT PHẢI (418px): Tổng thanh toán & Đồng hồ đếm ngược (Figma 1:3716) */}
        <aside className="booking-review-sidebar" aria-label="Tổng quan thanh toán">
          <div className="review-card">
            {/* Countdown card */}
            <div
              className={`payment-countdown-card ${
                bookingState === 'confirmed' ? 'is-confirmed' : isExpired ? 'is-expired' : ''
              }`}
            >
              <span className="payment-countdown-label">
                {bookingState === 'confirmed'
                  ? 'Hệ thống đã xác nhận thu'
                  : isExpired
                    ? 'Đã hết hạn giữ chỗ (10 phút)'
                    : paymentMethod === 'counter'
                      ? 'Thanh toán tại quầy trước khi hết hạn'
                      : 'Giữ chỗ 10 phút · Còn lại'}
              </span>
              <span className="payment-countdown-timer">
                {bookingState === 'confirmed'
                  ? '150.000 đ'
                  : isExpired
                    ? '00:00'
                    : formatTimer(countdownSeconds)}
              </span>
            </div>

            {/* Chi tiết thanh toán */}
            <div className="payment-breakdown-list">
              <h3 className="review-card-title" style={{ fontSize: '15px', marginTop: '12px' }}>
                Chi tiết thanh toán
              </h3>
              <div className="payment-breakdown-row">
                <span className="muted">Phí khám</span>
                <span>150.000 đ</span>
              </div>
              <div className="payment-breakdown-row">
                <span className="muted">Phí dịch vụ</span>
                <span>0 đ</span>
              </div>
              <div className="payment-divider" />
              <div className="payment-total-row">
                <span className="payment-total-label">Tổng thanh toán</span>
                <span className="payment-total-amount">150.000 đ</span>
              </div>
            </div>

            {/* Cam kết điều khoản */}
            {bookingState !== 'confirmed' && !isExpired && (
              <label className="payment-terms-label">
                <input
                  type="checkbox"
                  className="payment-terms-checkbox"
                  checked={agreedTerms}
                  onChange={(e) => setAgreedTerms(e.target.checked)}
                />
                <span>
                  Tôi đồng ý với điều khoản đặt khám và chính sách thanh toán của bệnh viện.
                </span>
              </label>
            )}

            {/* Hiển thị lỗi nếu có */}
            {bookingState === 'error' && (
              <div style={{ marginBottom: '16px' }}>
                <ErrorPanel error={error} onRetry={confirm} />
              </div>
            )}

            {/* Nút hành động */}
            {bookingState === 'confirmed' ? (
              <button
                type="button"
                className="btn-payment-action"
                onClick={() =>
                  navigate(
                    `/patient/appointments/${encodeURIComponent(confirmedAppointmentId || 'UMC091126')}`,
                  )
                }
              >
                Xem lịch khám của tôi  →
              </button>
            ) : isExpired ? (
              <button
                type="button"
                className="btn-payment-action"
                onClick={() => navigate('/patient/appointments/new')}
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
              <span>Hỗ trợ giao dịch: <strong>1900 7178</strong></span>
              {bookingState === 'idle' && !isExpired && (
                <button
                  type="button"
                  className="btn-demo-expired"
                  onClick={handleSimulateExpired}
                >
                  Mô phỏng hết hạn giữ chỗ
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import { formatAppointmentTime } from '../display';
import type { AppointmentApi } from '../types';
import type { BillingApi } from '../../billing/types';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import { Loading } from '../../../shared/ui/Loading';
import '../appointment.css';

type BookingState =
  | 'idle'
  | 'creating'
  | 'waiting_counter'
  | 'processing_simulate'
  | 'confirmed'
  | 'payment_failed'
  | 'error';

type PaymentMethodType = 'simulate' | 'momo' | 'atm' | 'counter';

export function BookingReview({
  api,
  billingApi,
}: {
  api: AppointmentApi;
  billingApi?: BillingApi;
}) {
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
  const doctorName = details?.doctorName || params.get('doctorName') || 'TS.BS Nguyễn Minh Anh';
  const specialty = details?.departmentName || params.get('specialty') || 'Tim mạch';
  const timeSlot =
    details?.timeSlot ||
    (details?.startAt ? formatAppointmentTime(details.startAt) : '') ||
    params.get('timeSlot') ||
    '08:30 · 09/11/2026';
  const location = params.get('location') || 'Phòng 204 · Cơ sở 1';
  const patientName = details?.patientName || params.get('patientName') || 'Nguyễn Hoàng Nam';
  const amountVnd = details?.amountVnd ?? 150000;

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>('simulate');
  const [agreedTerms, setAgreedTerms] = useState(true);
  const [countdownSeconds, setCountdownSeconds] = useState(599); // 09:59
  const [simulatedExpired, setSimulatedExpired] = useState(false);

  const [bookingState, setBookingState] = useState<BookingState>('idle');
  const [confirmedAppointmentId, setConfirmedAppointmentId] = useState<string>('');
  const [error, setError] = useState<unknown>();
  const idempotency = useRef<{ holdId: string; key: string } | null>(null);

  const isExpired = simulatedExpired || expired;
  const currentSeconds = Number.isFinite(expiresAt) ? seconds : countdownSeconds;

  // Countdown 10 phút fallback khi không có expiresAt từ server
  useEffect(() => {
    if (
      Number.isFinite(expiresAt) ||
      bookingState === 'confirmed' ||
      simulatedExpired
    )
      return;

    const timer = setInterval(() => {
      setCountdownSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setSimulatedExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [expiresAt, bookingState, simulatedExpired]);

  const formatTimer = (totalSec: number) => {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  async function handleSimulatePaymentProcess(apptId: string) {
    setBookingState('processing_simulate');
    setError(undefined);

    if (billingApi) {
      try {
        // Tra cứu khoản thu OPEN của bệnh nhân
        const chargesRes = await billingApi
          .getPatientCharges(patientId, { state: 'OPEN' })
          .catch(() => ({ items: [] }));
        const targetCharge =
          chargesRes.items.find(
            (c) => c.sourceType === 'APPOINTMENT' && c.sourceId === apptId,
          ) || chargesRes.items[0];

        const chargeId = targetCharge?.id || `charge-${apptId}`;
        const txnId = `TXN-SIM-${Date.now()}`;

        // Gọi API mô phỏng thanh toán (BI-004)
        const simResult = await billingApi.simulatePayment(
          { chargeId, transactionId: txnId },
          crypto.randomUUID(),
        );

        if (simResult.state === 'FAILED') {
          setBookingState('payment_failed');
          setError(
            new Error('Giao dịch mô phỏng bị từ chối từ cổng thanh toán.'),
          );
        } else {
          setBookingState('confirmed');
        }
      } catch (simErr) {
        setBookingState('payment_failed');
        setError(simErr);
      }
    } else {
      // Fallback môi trường test khi không có billingApi
      setBookingState('confirmed');
    }
  }

  async function confirm() {
    if (
      bookingState === 'creating' ||
      bookingState === 'processing_simulate' ||
      isExpired ||
      !agreedTerms
    )
      return;

    if (idempotency.current?.holdId !== holdId) {
      idempotency.current = { holdId, key: crypto.randomUUID() };
    }
    const idempotencyKey = idempotency.current.key;

    setBookingState('creating');
    setError(undefined);

    try {
      // 1. Tạo lịch hẹn (AP-010) - server trả về 202 ACCEPTED với state: PENDING_PAYMENT
      const appointmentResult = await api.createAppointment(
        { patientId, holdId },
        idempotencyKey,
      );
      const apptId = appointmentResult.appointmentId || 'UMC091126';
      setConfirmedAppointmentId(apptId);

      // 2. Nhánh Thanh toán tại quầy (Figma 04.09)
      if (paymentMethod === 'counter') {
        setBookingState('waiting_counter');
        return;
      }

      // 3. Nhánh Thanh toán mô phỏng / online (Figma 04.01 -> 04.03 -> 04.05)
      await handleSimulatePaymentProcess(apptId);
    } catch (caught) {
      setBookingState('error');
      setError(caught);
    }
  }

  function handleRetryPayment() {
    if (confirmedAppointmentId) {
      void handleSimulatePaymentProcess(confirmedAppointmentId);
    } else {
      void confirm();
    }
  }

  function handleSimulateExpired() {
    setCountdownSeconds(0);
    setSimulatedExpired(true);
  }

  function handleSimulateFailure() {
    setBookingState('payment_failed');
    setError(new Error('Mô phỏng lỗi giao dịch: Ngân hàng từ chối thanh toán.'));
  }

  // Tiêu đề phụ chuẩn Figma
  const getPageSubtitle = () => {
    const displayId = confirmedAppointmentId || 'UMC091126';
    switch (bookingState) {
      case 'creating':
        return `Đang tạo khoản thu · ${displayId} · ${patientName}`;
      case 'waiting_counter':
        return `Lịch chờ thanh toán · ${displayId} · ${patientName}`;
      case 'processing_simulate':
        return `Đang xử lý thanh toán · ${displayId} · ${patientName}`;
      case 'confirmed':
        return `Lịch đã xác nhận · ${displayId} · ${patientName}`;
      case 'payment_failed':
        return `Thanh toán thất bại · ${displayId} · ${patientName}`;
      case 'error':
        return `Có lỗi xảy ra · ${patientName}`;
      default:
        if (isExpired) return `Đã hết hạn giữ chỗ · ${patientName}`;
        if (paymentMethod === 'counter')
          return `Thanh toán tại quầy · ${patientName}`;
        return 'Kiểm tra thông tin trước khi hoàn tất đặt khám.';
    }
  };

  // Huy hiệu trạng thái trên review-card
  const getBadgeInfo = () => {
    if (isExpired) {
      return { label: 'Đã hết hạn giữ chỗ', className: 'is-expired' };
    }
    switch (bookingState) {
      case 'creating':
        return { label: 'Đang tạo khoản thu', className: 'is-held' };
      case 'waiting_counter':
        return { label: 'Lịch chờ thanh toán', className: 'is-counter' };
      case 'processing_simulate':
        return { label: 'Đang xử lý thanh toán', className: 'is-held' };
      case 'confirmed':
        return { label: 'Lịch đã xác nhận', className: 'is-confirmed' };
      case 'payment_failed':
        return { label: 'Thanh toán thất bại', className: 'is-expired' };
      default:
        if (paymentMethod === 'counter') {
          return { label: 'Thanh toán tại quầy', className: 'is-counter' };
        }
        return { label: 'Chờ thanh toán', className: 'is-held' };
    }
  };

  // Ghi chú dưới phương thức thanh toán chuẩn Figma
  const getPaymentNote = () => {
    if (isExpired) {
      return 'Khung giờ đã được giải phóng. Chọn lại trước khi thanh toán.';
    }
    switch (bookingState) {
      case 'creating':
        return 'Hệ thống đang chuẩn bị hồ sơ và khởi tạo khoản thu.';
      case 'waiting_counter':
        return 'Lịch đang chờ thanh toán · Chưa xác nhận · Chưa cấp số khám.';
      case 'processing_simulate':
        return 'Đang chờ kết quả từ hệ thống. Không tạo giao dịch mới.';
      case 'confirmed':
        return `Phí khám đã thanh toán · Lịch ${confirmedAppointmentId || 'UMC091126'} đã xác nhận.`;
      case 'payment_failed':
        return 'Giao dịch chưa hoàn tất. Bạn có thể thử lại hoặc chuyển sang thanh toán tại quầy.';
      default:
        if (paymentMethod === 'counter') {
          return 'Lịch chờ thanh toán tại quầy. Chưa xác nhận cho tới khi hoàn tất thu phí.';
        }
        return 'Chỉ xác nhận lịch sau khi hệ thống xác nhận đã thu.';
    }
  };

  const badgeInfo = getBadgeInfo();

  if (!patientId || !holdId) {
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
      {/* Header Banner theo Figma Frame 04 */}
      <div className="patient-header-banner">
        <span className="page-eyebrow">CHĂM SÓC SỨC KHỎE</span>
        <h1 id="review-heading" className="page-title">
          Xác nhận &amp; thanh toán
        </h1>
        <p className="page-subtitle">{getPageSubtitle()}</p>
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
              <span className={`review-badge ${badgeInfo.className}`}>
                {badgeInfo.label}
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
                onClick={() => {
                  if (
                    bookingState === 'idle' ||
                    bookingState === 'payment_failed'
                  ) {
                    setPaymentMethod('simulate');
                  }
                }}
                onKeyDown={(e) => {
                  if (
                    (e.key === ' ' || e.key === 'Enter') &&
                    (bookingState === 'idle' ||
                      bookingState === 'payment_failed')
                  ) {
                    setPaymentMethod('simulate');
                  }
                }}
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

              {/* Option 2: Ví MoMo */}
              <div
                role="radio"
                tabIndex={0}
                aria-checked={paymentMethod === 'momo'}
                className={`payment-option-card ${paymentMethod === 'momo' ? 'is-selected' : ''}`}
                onClick={() => {
                  if (
                    bookingState === 'idle' ||
                    bookingState === 'payment_failed'
                  ) {
                    setPaymentMethod('momo');
                  }
                }}
                onKeyDown={(e) => {
                  if (
                    (e.key === ' ' || e.key === 'Enter') &&
                    (bookingState === 'idle' ||
                      bookingState === 'payment_failed')
                  ) {
                    setPaymentMethod('momo');
                  }
                }}
              >
                <span className="payment-radio-circle" aria-hidden="true" />
                <div className="payment-option-info">
                  <span className="payment-option-title">Ví MoMo</span>
                  <span className="payment-option-desc">
                    Thanh toán với ví điện tử
                  </span>
                </div>
              </div>

              {/* Option 3: Thẻ ATM nội địa */}
              <div
                role="radio"
                tabIndex={0}
                aria-checked={paymentMethod === 'atm'}
                className={`payment-option-card ${paymentMethod === 'atm' ? 'is-selected' : ''}`}
                onClick={() => {
                  if (
                    bookingState === 'idle' ||
                    bookingState === 'payment_failed'
                  ) {
                    setPaymentMethod('atm');
                  }
                }}
                onKeyDown={(e) => {
                  if (
                    (e.key === ' ' || e.key === 'Enter') &&
                    (bookingState === 'idle' ||
                      bookingState === 'payment_failed')
                  ) {
                    setPaymentMethod('atm');
                  }
                }}
              >
                <span className="payment-radio-circle" aria-hidden="true" />
                <div className="payment-option-info">
                  <span className="payment-option-title">Thẻ ATM nội địa</span>
                  <span className="payment-option-desc">
                    Hỗ trợ ngân hàng trong nước
                  </span>
                </div>
              </div>

              {/* Option 4: Thanh toán tại quầy */}
              <div
                role="radio"
                tabIndex={0}
                aria-checked={paymentMethod === 'counter'}
                className={`payment-option-card ${paymentMethod === 'counter' ? 'is-selected' : ''}`}
                onClick={() => {
                  if (
                    bookingState === 'idle' ||
                    bookingState === 'payment_failed'
                  ) {
                    setPaymentMethod('counter');
                  }
                }}
                onKeyDown={(e) => {
                  if (
                    (e.key === ' ' || e.key === 'Enter') &&
                    (bookingState === 'idle' ||
                      bookingState === 'payment_failed')
                  ) {
                    setPaymentMethod('counter');
                  }
                }}
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

            <p className="payment-note-text">{getPaymentNote()}</p>
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
                bookingState === 'confirmed'
                  ? 'is-confirmed'
                  : isExpired
                    ? 'is-expired'
                    : ''
              }`}
            >
              <span className="payment-countdown-label">
                {bookingState === 'confirmed'
                  ? 'Hệ thống đã xác nhận thu'
                  : isExpired
                    ? 'Đã hết hạn giữ chỗ (10 phút)'
                    : paymentMethod === 'counter' ||
                        bookingState === 'waiting_counter'
                      ? 'Thanh toán tại quầy trước khi hết hạn'
                      : 'Giữ chỗ 10 phút · Còn lại'}
              </span>
              <span className="payment-countdown-timer">
                {bookingState === 'confirmed'
                  ? `${amountVnd.toLocaleString('vi-VN')} đ`
                  : isExpired
                    ? '00:00'
                    : formatTimer(currentSeconds)}
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
                <span>{amountVnd.toLocaleString('vi-VN')} đ</span>
              </div>
              <div className="payment-breakdown-row">
                <span className="muted">Giảm trừ BHYT</span>
                <span>0 đ</span>
              </div>
              <div className="payment-breakdown-row">
                <span className="muted">Phí dịch vụ</span>
                <span>0 đ</span>
              </div>
              <div className="payment-divider" />
              <div className="payment-total-row">
                <span className="payment-total-label">Tổng thanh toán</span>
                <span className="payment-total-amount">
                  {amountVnd.toLocaleString('vi-VN')} đ
                </span>
              </div>
            </div>

            {/* Cam kết điều khoản */}
            {bookingState !== 'confirmed' &&
              bookingState !== 'waiting_counter' &&
              !isExpired && (
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

            {/* Hiển thị loading & lỗi */}
            {bookingState === 'creating' && (
              <Loading label="Đang tạo lịch hẹn &amp; khoản thu…" />
            )}
            {bookingState === 'processing_simulate' && (
              <Loading label="Đang xử lý thanh toán mô phỏng…" />
            )}
            {(bookingState === 'error' ||
              bookingState === 'payment_failed') && (
              <div style={{ marginBottom: '16px' }}>
                <ErrorPanel
                  error={error}
                  onRetry={
                    bookingState === 'payment_failed'
                      ? handleRetryPayment
                      : confirm
                  }
                />
              </div>
            )}

            {/* Nút hành động theo từng trạng thái */}
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
                Xem lịch khám của tôi →
              </button>
            ) : bookingState === 'waiting_counter' ? (
              <button
                type="button"
                className="btn-payment-action"
                onClick={() =>
                  navigate(
                    `/patient/appointments/${encodeURIComponent(confirmedAppointmentId || 'UMC091126')}`,
                  )
                }
              >
                Xem lịch chờ thanh toán →
              </button>
            ) : isExpired ? (
              <button
                type="button"
                className="btn-payment-action"
                onClick={() => navigate(back)}
              >
                Chọn lại khung giờ
              </button>
            ) : bookingState === 'payment_failed' ? (
              <button
                type="button"
                className="btn-payment-action"
                aria-label="Thử lại thanh toán"
                onClick={handleRetryPayment}
              >
                Thử lại thanh toán
              </button>
            ) : (
              <button
                type="button"
                className="btn-payment-action"
                aria-label="Xác nhận tạo lịch"
                disabled={
                  !agreedTerms ||
                  bookingState === 'creating' ||
                  bookingState === 'processing_simulate'
                }
                onClick={confirm}
              >
                {bookingState === 'creating'
                  ? 'Đang tạo khoản thu…'
                  : bookingState === 'processing_simulate'
                    ? 'Đang xử lý · Không thanh toán lại'
                    : paymentMethod === 'counter'
                      ? 'Tạo lịch chờ thanh toán'
                      : 'Xác nhận tạo lịch'}
              </button>
            )}

            {/* Support footer & Demo buttons */}
            <div className="payment-support-footer">
              <span>
                Hỗ trợ giao dịch: <strong>1900 7178</strong>
              </span>
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  flexWrap: 'wrap',
                  marginTop: '8px',
                }}
              >
                {bookingState === 'idle' && !isExpired && (
                  <>
                    <button
                      type="button"
                      className="btn-demo-expired"
                      onClick={handleSimulateExpired}
                    >
                      Mô phỏng hết hạn giữ chỗ
                    </button>
                    <button
                      type="button"
                      className="btn-demo-expired"
                      onClick={handleSimulateFailure}
                    >
                      Mô phỏng thanh toán thất bại
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

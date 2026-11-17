import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  ContactRound,
  Bell,
  ArrowRight,
  Clock,
  MapPin,
  User,
  ShieldCheck,
} from 'lucide-react';
import '../patient.css';

export interface PatientHomeProps {
  hasAppointmentDefault?: boolean;
}

export function PatientHome({
  hasAppointmentDefault = true,
}: PatientHomeProps) {
  // Cho phép chuyển đổi linh hoạt giữa 2 trạng thái Figma:
  // - 25:2 (Có lịch khám sắp tới)
  // - 25:11 (Chưa có lịch khám)
  const [hasAppointment, setHasAppointment] = useState(hasAppointmentDefault);

  return (
    <div className="home-container" aria-label="Trang chủ bệnh nhân">
      {/* 1. Lời chào (Figma 25:7 / 25:16) */}
      <section className="home-hero-banner home-animate-hero" aria-labelledby="hero-title">
        <span className="home-eyebrow">CHĂM SÓC SỨC KHỎE</span>
        <h1 id="hero-title" className="home-hero-title">
          Chào bạn!
        </h1>
        <p className="home-hero-desc">
          Đặt lịch khám và theo dõi lịch hẹn của bạn.
        </p>

        <Link
          to="/patient/appointments/new"
          className="home-btn-primary"
          aria-label="Đặt lịch khám ngay"
        >
          <span>Đặt lịch khám</span>
          <ArrowRight size={18} className="home-btn-arrow" />
        </Link>

        <p className="home-hero-note">
          Bạn sẽ chọn hồ sơ người khám trong bước đặt lịch.
        </p>
      </section>

      {/* 2. Lịch khám sắp tới (Figma 25:8 / 25:17) */}
      <section
        className="home-section home-animate-upcoming"
        aria-labelledby="upcoming-heading"
      >
        <div className="home-section-header">
          <div className="home-title-with-toggle">
            <h2 id="upcoming-heading" className="home-section-title">
              Lịch khám sắp tới
            </h2>
            {/* Nút chuyển đổi nhanh để duyệt cả 2 kịch bản Figma 25:2 và 25:11 */}
            <div className="home-state-switch" role="group" aria-label="Kịch bản hiển thị lịch">
              <button
                type="button"
                className={`home-switch-pill ${hasAppointment ? 'is-active' : ''}`}
                aria-pressed={hasAppointment}
                onClick={() => setHasAppointment(true)}
              >
                Có lịch hẹn (25:2)
              </button>
              <button
                type="button"
                className={`home-switch-pill ${!hasAppointment ? 'is-active' : ''}`}
                aria-pressed={!hasAppointment}
                onClick={() => setHasAppointment(false)}
              >
                Chưa có lịch (25:11)
              </button>
            </div>
          </div>

          {hasAppointment && (
            <Link
              to="/patient/appointments"
              className="home-section-link"
              aria-label="Xem toàn bộ lịch khám"
            >
              Xem lịch khám →
            </Link>
          )}
        </div>

        {hasAppointment ? (
          /* Trạng thái có lịch khám (Figma 25:2 - 25:188) */
          <article className="home-appointment-card animate-scale-in">
            <div className="home-card-topbar">
              <span className="home-appt-code">Mã lịch: UMC091126</span>
              <span className="home-badge-confirmed">
                <ShieldCheck size={14} style={{ marginRight: '4px' }} />
                Lịch đã xác nhận · Đã thu
              </span>
            </div>

            <div className="home-card-main">
              {/* Khối Ngày & Giờ khám */}
              <div className="home-datetime-badge">
                <span className="home-time-text">08:30 · Thứ Hai</span>
                <span className="home-date-text">09/11/2026</span>
              </div>

              {/* Thông tin bác sĩ & người khám */}
              <div className="home-appt-details">
                <p className="home-patient-name">
                  <User size={15} className="home-inline-icon" />
                  Người khám: <strong>Nguyễn Hoàng Nam</strong>
                </p>
                <h3 className="home-doctor-name">TS.BS Nguyễn Minh Anh</h3>
                <p className="home-doctor-dept">
                  <MapPin size={14} className="home-inline-icon" />
                  Chuyên khoa Tim mạch · Phòng 204
                </p>
              </div>
            </div>

            <div className="home-card-footer">
              <Clock size={14} className="home-inline-icon" />
              <span>
                Vui lòng đến trước giờ hẹn 15 phút để làm thủ tục tiếp nhận.
              </span>
            </div>
          </article>
        ) : (
          /* Trạng thái chưa có lịch khám (Figma 25:11 - 25:204) */
          <div className="home-empty-card animate-scale-in">
            <div className="home-empty-icon-box" aria-hidden="true">
              <CalendarDays size={24} />
            </div>
            <h3 className="home-empty-title">Bạn chưa có lịch khám sắp tới</h3>
            <p className="home-empty-desc">
              Chủ động chọn bác sĩ và thời gian phù hợp cho bạn hoặc người thân.
            </p>
            <Link
              to="/patient/appointments/new"
              className="home-btn-primary home-btn-sm"
            >
              Đặt lịch khám
            </Link>
            <p className="home-empty-note">
              Bạn sẽ chọn hồ sơ người khám khi đặt lịch.
            </p>
          </div>
        )}
      </section>

      {/* 3. Truy cập nhanh (Figma 25:9 / 25:18) */}
      <section
        className="home-section home-animate-shortcuts"
        aria-labelledby="shortcuts-heading"
      >
        <h2 id="shortcuts-heading" className="home-section-title">
          Truy cập nhanh
        </h2>

        <div className="home-shortcuts-grid">
          {/* Lối tắt 1: Hồ sơ của tôi */}
          <Link
            to="/patient/profiles"
            className="home-shortcut-card"
            aria-label="Mở hồ sơ của tôi"
          >
            <div className="home-shortcut-icon" aria-hidden="true">
              <ContactRound size={22} />
            </div>
            <div className="home-shortcut-body">
              <h3 className="home-shortcut-title">Hồ sơ của tôi</h3>
              <p className="home-shortcut-desc">
                Quản lý hồ sơ của bạn và người thân.
              </p>
            </div>
          </Link>

          {/* Lối tắt 2: Lịch khám của tôi */}
          <Link
            to="/patient/appointments"
            className="home-shortcut-card"
            aria-label="Mở lịch khám của tôi"
          >
            <div className="home-shortcut-icon" aria-hidden="true">
              <CalendarDays size={22} />
            </div>
            <div className="home-shortcut-body">
              <h3 className="home-shortcut-title">Lịch khám của tôi</h3>
              <p className="home-shortcut-desc">
                Theo dõi và xem chi tiết lịch hẹn.
              </p>
            </div>
          </Link>

          {/* Lối tắt 3: Thông báo */}
          <Link
            to="/patient/appointments?tab=lab"
            className="home-shortcut-card"
            aria-label="Mở thông báo và kết quả mới"
          >
            <div className="home-shortcut-icon" aria-hidden="true">
              <Bell size={22} />
            </div>
            <div className="home-shortcut-body">
              <h3 className="home-shortcut-title">Thông báo</h3>
              <p className="home-shortcut-desc">
                Cập nhật thông tin chăm sóc sức khỏe.
              </p>
            </div>
          </Link>
        </div>
      </section>
    </div>
  );
}

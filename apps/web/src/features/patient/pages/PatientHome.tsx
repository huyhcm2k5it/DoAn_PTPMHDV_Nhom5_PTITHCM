import { ContactRound, CalendarDays, Pill } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  AppointmentApi,
  AppointmentSummary,
} from '../../appointment/types';
import {
  appointmentLabels,
  formatAppointmentTime,
} from '../../appointment/display';
import type { PatientApi } from '../types';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import '../patient.css';

export function PatientHome({
  patientApi,
  appointmentApi,
}: {
  patientApi?: PatientApi;
  appointmentApi?: AppointmentApi;
}) {
  const [upcoming, setUpcoming] = useState<
    (AppointmentSummary & { patientName: string }) | null
  >();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    if (!patientApi || !appointmentApi) return;
    const controller = new AbortController();
    const { signal } = controller;
    setUpcoming(undefined);
    setError(undefined);
    async function load() {
      const { items: profiles } = await patientApi!.list(1, 100, signal);
      const from = new Intl.DateTimeFormat('sv-SE', {
        dateStyle: 'short',
        timeZone: 'Asia/Ho_Chi_Minh',
      }).format(Date.now());
      const pages = await Promise.all(
        profiles
          .filter((profile) => profile.active !== false)
          .map(async (profile) => {
            const results = await Promise.all(
              ['CONFIRMED', 'PENDING_PAYMENT'].map((state) =>
                appointmentApi!.listAppointments(profile.id, signal, {
                  from,
                  state,
                }),
              ),
            );
            return results
              .flatMap((page) => page.items)
              .map((item) => ({
                ...item,
                patientName: profile.fullName,
              }));
          }),
      );
      const start = (item: AppointmentSummary) =>
        Date.parse(String(item.appointment?.startAt ?? ''));
      const next = pages
        .flat()
        .filter(
          (item) =>
            ['CONFIRMED', 'PENDING_PAYMENT'].includes(item.state) &&
            start(item) >= Date.now(),
        )
        .sort((a, b) => start(a) - start(b))[0];
      if (!signal.aborted) setUpcoming(next ?? null);
    }
    void load().catch((caught) => {
      if (!signal.aborted) setError(caught);
    });
    return () => controller.abort();
  }, [patientApi, appointmentApi]);
  return (
    <div className="page-content quan-workflow patient-home-design">
      <section className="home-hero-banner">
        <p className="eyebrow">CHĂM SÓC SỨC KHỎE</p>
        <h1>Chào bạn!</h1>
        <p>Đặt lịch khám và theo dõi lịch hẹn của bạn.</p>
        <Link to="/patient/appointments/new" className="button button-primary">
          Đặt lịch khám →
        </Link>
        <p className="field-hint">
          Bạn sẽ chọn hồ sơ người khám trong bước đặt lịch.
        </p>
      </section>
      <div className="section-heading">
        <h2>Lịch khám sắp tới</h2>
        <Link to="/patient/appointments">Xem lịch khám →</Link>
      </div>
      <section className="state-card upcoming-card">
        {!patientApi ? (
          <Link to="/login">Đăng nhập để xem lịch khám</Link>
        ) : error != null ? (
          <ErrorPanel error={error} />
        ) : upcoming === undefined ? (
          <p role="status">Đang tải lịch khám…</p>
        ) : upcoming ? (
          <>
            <div className="section-heading">
              <p className="field-hint">Mã lịch: {upcoming.appointmentId}</p>
              <span className="status-pill">
                {appointmentLabels[upcoming.state]}
              </span>
            </div>
            <div className="upcoming-details">
              <div className="upcoming-date">
                {formatAppointmentTime(upcoming.appointment?.startAt)}
              </div>
              <div>
                <p>
                  Người khám: <strong>{upcoming.patientName}</strong>
                </p>
                <Link
                  to={
                    '/patient/appointments/' +
                    encodeURIComponent(upcoming.appointmentId)
                  }
                >
                  Xem thông tin lịch khám →
                </Link>
              </div>
            </div>
            <p className="field-hint">
              Vui lòng đến trước giờ hẹn để làm thủ tục tiếp nhận.
            </p>
          </>
        ) : (
          <div className="home-empty">
            <h3>Chưa có lịch khám sắp tới</h3>
            <p>Chọn bác sĩ và thời gian phù hợp để đặt lịch khám.</p>
            <Link
              to="/patient/appointments/new"
              className="button button-primary"
            >
              Đặt lịch khám
            </Link>
          </div>
        )}
      </section>
      <h2>Truy cập nhanh</h2>
      <nav className="quan-home-links" aria-label="Tiện ích bệnh nhân">
        <Link to="/patient/profiles" className="state-card">
          <ContactRound size={20} />
          <strong>Hồ sơ của tôi</strong>
          <span>Quản lý hồ sơ của bạn và người thân.</span>
        </Link>
        <Link to="/patient/appointments" className="state-card">
          <CalendarDays size={20} />
          <strong>Lịch khám của tôi</strong>
          <span>Theo dõi và xem chi tiết lịch hẹn.</span>
        </Link>
        <Link to="/patient/medications" className="state-card">
          <Pill size={20} />
          <strong>Đơn thuốc</strong>
          <span>Theo dõi trạng thái cấp phát thuốc.</span>
        </Link>
      </nav>
    </div>
  );
}

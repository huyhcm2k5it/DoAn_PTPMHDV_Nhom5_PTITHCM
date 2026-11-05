import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';
import { createPatientApi } from '../features/patient/api';
import type { PatientApi } from '../features/patient/types';
import { ProfileList } from '../features/patient/pages/ProfileList';
import { ProfileDetail } from '../features/patient/pages/ProfileDetail';
import { ProfileForm } from '../features/patient/pages/ProfileForm';
import { createAppointmentApi } from '../features/appointment/api';
import type { AppointmentApi } from '../features/appointment/types';
import { AvailableSlots } from '../features/appointment/pages/AvailableSlots';
import { BookingReview } from '../features/appointment/pages/BookingReview';
import { MyAppointments } from '../features/appointment/pages/MyAppointments';
import { AppointmentDetail } from '../features/appointment/pages/AppointmentDetail';
import { ReceptionQueue } from '../features/appointment/pages/ReceptionQueue';
import { ScheduleAdmin } from '../features/appointment/pages/ScheduleAdmin';
import { AdminSummary } from '../features/appointment/pages/AdminSummary';
import { createCatalogApi } from '../features/catalog/api';
import type { CatalogApi } from '../features/catalog/types';
import { createClinicalApi } from '../features/clinical/api';
import { ClinicalFeature } from '../features/clinical/ClinicalFeature';
import type { ClinicalApi } from '../features/clinical/types';
import { createDiagnosticApi } from '../features/diagnostic/api';
import { DiagnosticFeature } from '../features/diagnostic/DiagnosticFeature';
import type { DiagnosticApi } from '../features/diagnostic/types';
import { withAuthRedirect } from './runtime';
import type { WebRuntime } from './runtime';
import './app.css';

const noAdapter = async (): Promise<Response> => {
  throw new Error('Shared API/session adapter của Hưng chưa được nạp vào web shell.');
};

function AppLayout({ session }: { session?: WebRuntime['session'] }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="brand" to="/patient/profiles">
          <span className="brand-mark" aria-hidden="true">
            U
          </span>
          <span>
            UMC <strong>Care</strong>
          </span>
        </Link>
        <span className="header-caption">CHĂM SÓC SỨC KHỎE</span>
      </header>
      <div className="app-body">
        <aside className="app-sidebar">
          <p className="nav-label">BỆNH NHÂN</p>
          <nav aria-label="Điều hướng chính">
            <Link to="/patient/profiles">Hồ sơ của tôi</Link>
            <Link to="/patient/profiles/new">Tạo hồ sơ</Link>
            <Link to="/patient/appointments/new">Tra cứu lịch khám</Link>
            <Link to="/patient/appointments">Lịch hẹn</Link>
            {session?.actorType === 'DOCTOR' && <Link to="/doctor/clinical">Bàn khám</Link>}
            {session?.actorType === 'STAFF' && session.capabilities.includes('RECEPTION') && <Link to="/staff/reception">Quầy tiếp nhận</Link>}
            {session?.actorType === 'STAFF' && session.capabilities.includes('ADMIN') && <Link to="/staff/schedules">Quản trị ca khám</Link>}
            {session?.actorType === 'STAFF' && session.capabilities.includes('ADMIN') && <Link to="/staff/summary">Tổng hợp vận hành</Link>}
            {session?.actorType === 'STAFF' && session.capabilities.some((item) => item === 'LAB_TECH' || item === 'LAB_REVIEW') && <Link to="/staff/diagnostic">Phòng xét nghiệm</Link>}
          </nav>
          <div className="sidebar-help">
            <span className="help-icon" aria-hidden="true">
              i
            </span>
            <p>Thanh toán và trạng thái lịch được xác nhận từ máy chủ.</p>
          </div>
        </aside>
        <main className="app-main">
          <Outlet />
        </main>
      </div>
      <footer className="app-footer">UMC Care · Cổng chăm sóc sức khỏe</footer>
    </div>
  );
}

function ProfileDetailRoute({ api }: { api: PatientApi }) {
  const { patientId = '' } = useParams();
  return <ProfileDetail api={api} patientId={patientId} />;
}

function ProfileEditRoute({ api }: { api: PatientApi }) {
  const { patientId = '' } = useParams();
  const [profile, setProfile] = useState<Awaited<ReturnType<PatientApi['getById']>>>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    const controller = new AbortController();
    api.getById(patientId, controller.signal).then(setProfile, setError);
    return () => controller.abort();
  }, [api, patientId]);
  if (error) return <section className="page-content"><p role="alert">Không tải được hồ sơ.</p></section>;
  if (!profile) return <section className="page-content"><p role="status">Đang tải hồ sơ…</p></section>;
  return <ProfileForm api={api} initial={profile} />;
}

function AppRoutes({
  patientApi,
  appointmentApi,
  catalogApi,
  clinicalApi,
  diagnosticApi,
  session,
}: {
  patientApi: PatientApi;
  appointmentApi: AppointmentApi;
  catalogApi: Pick<CatalogApi, 'departments' | 'doctors' | 'services'>;
  clinicalApi: ClinicalApi;
  diagnosticApi: DiagnosticApi;
  session?: WebRuntime['session'];
}) {
  return (
    <Routes>
      <Route element={<AppLayout session={session} />}>
        <Route path="/" element={<Navigate to="/patient/profiles" replace />} />
        <Route path="/patient/profiles" element={<ProfileList api={patientApi} />} />
        <Route path="/patient/profiles/new" element={<ProfileForm api={patientApi} />} />
        <Route
          path="/patient/profiles/:patientId"
          element={<ProfileDetailRoute api={patientApi} />}
        />
        <Route path="/patient/profiles/:patientId/edit" element={<ProfileEditRoute api={patientApi} />} />
        <Route
          path="/patient/appointments/new"
          element={<AvailableSlots api={appointmentApi} catalog={catalogApi} />}
        />
        <Route
          path="/patient/appointments/review"
          element={<BookingReview api={appointmentApi} />}
        />
        <Route path="/patient/appointments" element={<MyAppointments api={appointmentApi} />} />
        <Route path="/staff/reception" element={<ReceptionQueue api={appointmentApi} />} />
        <Route path="/staff/schedules" element={<ScheduleAdmin api={appointmentApi} />} />
        <Route path="/staff/summary" element={<AdminSummary api={appointmentApi} />} />
        <Route path="/doctor/clinical" element={<ClinicalFeature api={clinicalApi} session={session ? { userId: session.userId, actorType: session.actorType } : undefined} />} />
        <Route path="/staff/diagnostic" element={<DiagnosticFeature api={diagnosticApi} session={session ? { userId: session.userId, actorType: session.actorType, capabilities: session.capabilities } : undefined} />} />
        <Route
          path="/patient/appointments/:appointmentId"
          element={<AppointmentDetail api={appointmentApi} />}
        />
        <Route
          path="*"
          element={
            <section className="page-content">
              <h1>Không tìm thấy trang</h1>
              <Link to="/patient/profiles">Về hồ sơ bệnh nhân</Link>
            </section>
          }
        />
      </Route>
    </Routes>
  );
}

export function App({ runtime }: { runtime?: WebRuntime }) {
  const transport = runtime?.transport ?? noAdapter;
  const apiTransport = useMemo(
    () => (runtime ? withAuthRedirect(runtime.transport, runtime.onUnauthorized) : transport),
    [runtime, transport],
  );
  const patientApi = useMemo(() => createPatientApi(apiTransport), [apiTransport]);
  const appointmentApi = useMemo(() => createAppointmentApi(apiTransport), [apiTransport]);
  const catalogApi = useMemo(() => createCatalogApi(apiTransport), [apiTransport]);
  const clinicalApi = useMemo(() => createClinicalApi(apiTransport, {
    authorizationLease: runtime?.session?.lease ? (action, resourceId) => runtime.session!.lease!(`${action}:${resourceId}`) : undefined,
  }), [apiTransport, runtime?.session?.lease]);
  const diagnosticApi = useMemo(() => createDiagnosticApi(apiTransport), [apiTransport]);
  return (
    <BrowserRouter>
      <AppRoutes patientApi={patientApi} appointmentApi={appointmentApi} catalogApi={catalogApi} clinicalApi={clinicalApi} diagnosticApi={diagnosticApi} session={runtime?.session} />
    </BrowserRouter>
  );
}

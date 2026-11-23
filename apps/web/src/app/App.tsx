import { useEffect, useMemo, useState } from 'react';
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import {
  House,
  CalendarPlus,
  CalendarDays,
  ContactRound,
  FileHeart,
  Pill,
  Bell,
  Stethoscope,
  ClipboardList,
  FlaskConical,
  Receipt,
  CalendarClock,
  LayoutDashboard,
} from 'lucide-react';
import { createPatientApi } from '../features/patient/api';
import type { PatientApi } from '../features/patient/types';
import { ProfileList } from '../features/patient/pages/ProfileList';
import { ProfileDetail } from '../features/patient/pages/ProfileDetail';
import { ProfileForm } from '../features/patient/pages/ProfileForm';
import { PatientHome } from '../features/patient/pages/PatientHome';
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
import { CatalogPage } from '../features/catalog/CatalogPage';
import type { CatalogApi } from '../features/catalog/types';
import { createClinicalApi } from '../features/clinical/api';
import { ClinicalRoute } from '../features/clinical/ClinicalRoute';
import { PatientRecordsRoute } from '../features/clinical/PatientRecordsRoute';
import type { ClinicalApi } from '../features/clinical/types';
import { createDiagnosticApi } from '../features/diagnostic/api';
import { DiagnosticFeature } from '../features/diagnostic/DiagnosticFeature';
import type { DiagnosticApi } from '../features/diagnostic/types';
import { createPharmacyApi } from '../features/pharmacy/api';
import type { PharmacyApi } from '../features/pharmacy/types';
import { createBillingApi } from '../features/billing/api';
import type { BillingApi } from '../features/billing/types';
import { StockPage } from '../features/pharmacy/pages/StockPage';
import { PrescriptionQueue } from '../features/pharmacy/pages/PrescriptionQueue';
import { PrescriptionDetail } from '../features/pharmacy/pages/PrescriptionDetail';
import { PatientMedicationStatus } from '../features/pharmacy/pages/PatientMedicationStatus';
import {
  withAuthRedirect,
  getWebRuntime,
  subscribeWebRuntime,
  logoutUser,
} from './runtime';
import type { WebRuntime } from './runtime';
import { LoginPage } from '../features/identity/LoginPage';
import './app.css';
import './quan-workflow.css';
import { RegisterPage } from '../features/identity/RegisterPage';
import { VerifyOtpPage } from '../features/identity/VerifyOtpPage';
import { ForgotPasswordPage } from '../features/identity/ForgotPasswordPage';
import { ResetPasswordPage } from '../features/identity/ResetPasswordPage';

const noAdapter = async (): Promise<Response> => {
  throw new Error(
    'Shared API/session adapter của Hưng chưa được nạp vào web shell.',
  );
};

function MedicalCross() {
  return <img src="/images/hqh/imgCross.svg" alt="" width="20" height="20" />;
}

function formatCurrentDateVi() {
  const days = [
    'Chủ Nhật',
    'Thứ Hai',
    'Thứ Ba',
    'Thứ Tư',
    'Thứ Năm',
    'Thứ Sáu',
    'Thứ Bảy',
  ];
  const now = new Date();
  const dayName = days[now.getDay()];
  const date = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  return `${dayName}, ${date}/${month}/${year}`;
}

export function homeForSession(session?: WebRuntime['session']) {
  if (!session) return '/login';
  if (session.actorType === 'DOCTOR') return '/doctor/clinical';
  if (session.actorType === 'STAFF') {
    const destinations = [
      ['ADMIN', '/staff/summary'],
      ['RECEPTION', '/staff/reception'],
      ['LAB_TECH', '/staff/diagnostic'],
      ['LAB_REVIEW', '/staff/diagnostic'],
      ['CASHIER', '/staff/cashier'],
      ['PHARMACY', '/staff/pharmacy'],
    ];
    return (
      destinations.find(([capability]) =>
        session.capabilities.includes(capability),
      )?.[1] ?? '/catalog'
    );
  }
  return '/patient/home';
}

function AppLayout({ session }: { session?: WebRuntime['session'] }) {
  const location = useLocation();
  const pathname = location.pathname;
  const search = location.search;
  const workspaceLabel: Record<string, string> = {
    '/doctor/clinical': 'Bác sĩ / Bàn khám',
    '/doctor/treatment': 'Bác sĩ / Chỉ định & kê đơn',
    '/staff/diagnostic': 'Xét nghiệm / Hàng chờ & kết quả',
    '/catalog': 'Danh mục / Dịch vụ & giá',
    '/patient/lab-results': 'Hồ sơ sức khỏe / Kết quả xét nghiệm',
    '/patient/medical-records': 'Hồ sơ sức khỏe / Bệnh án & toa đã ký',
  };

  const isHomeActive = pathname === '/' || pathname === '/patient/home';
  const isBookingActive =
    pathname.startsWith('/patient/appointments/new') ||
    pathname.startsWith('/patient/appointments/review');
  const isMyAppointmentsActive =
    (pathname === '/patient/appointments' ||
      (/^\/patient\/appointments\/[^/]+$/.test(pathname) &&
        !pathname.includes('/new') &&
        !pathname.includes('/review'))) &&
    !search.includes('tab=lab');
  const isProfileActive = pathname.startsWith('/patient/profiles');
  const isLabResultsActive =
    pathname === '/patient/lab-results' ||
    (pathname === '/patient/appointments' && search.includes('tab=lab'));
  const isPrescriptionActive =
    pathname.startsWith('/patient/medications') ||
    pathname.startsWith('/patient/prescriptions') ||
    (pathname === '/patient/appointments' &&
      search.includes('tab=prescription'));

  const roleCaption =
    session?.actorType === 'DOCTOR'
      ? 'Bác sĩ điều trị'
      : session?.actorType === 'STAFF'
        ? 'Nhân viên y tế'
        : 'Tài khoản bệnh nhân';

  const sidebarCategory =
    session?.actorType === 'DOCTOR'
      ? 'CỔNG BÁC SĨ'
      : session?.actorType === 'STAFF'
        ? 'CỔNG NHÂN VIÊN'
        : 'CỔNG BỆNH NHÂN';

  return (
    <div className="app-shell">
      <aside className="app-sidebar" aria-label="Điều hướng">
        <Link className="brand-section" to={homeForSession(session)}>
          <div className="brand-logo-icon" aria-hidden="true">
            <MedicalCross />
          </div>
          <span className="brand-title">HQH CARE</span>
        </Link>

        <p className="sidebar-caption">{sidebarCategory}</p>

        <nav className="sidebar-nav" aria-label="Điều hướng chính">
          {(!session || session.actorType === 'PATIENT') && (
            <>
              <Link
                to="/patient/home"
                className={`sidebar-nav-item ${isHomeActive ? 'is-active' : ''}`}
              >
                <img
                  src="/images/hqh/imgHouse.svg"
                  className="sidebar-nav-icon"
                  width="20"
                  height="20"
                  alt=""
                />
                <span>Trang chủ</span>
              </Link>
              <Link
                to="/patient/appointments/new"
                className={`sidebar-nav-item ${isBookingActive ? 'is-active' : ''}`}
              >
                <img
                  src="/images/hqh/imgCalendarPlus.svg"
                  className="sidebar-nav-icon"
                  width="20"
                  height="20"
                  alt=""
                />
                <span>Đặt lịch khám</span>
              </Link>
              <Link
                to="/patient/appointments"
                className={`sidebar-nav-item ${isMyAppointmentsActive ? 'is-active' : ''}`}
              >
                <img
                  src="/images/hqh/imgCalendarDays.svg"
                  className="sidebar-nav-icon"
                  width="20"
                  height="20"
                  alt=""
                />
                <span>Lịch khám của tôi</span>
              </Link>
              <Link
                to="/patient/profiles"
                className={`sidebar-nav-item ${isProfileActive ? 'is-active' : ''}`}
              >
                <img
                  src="/images/hqh/imgContactRound.svg"
                  className="sidebar-nav-icon"
                  width="20"
                  height="20"
                  alt=""
                />
                <span>Hồ sơ của tôi</span>
              </Link>
              <Link
                to="/patient/lab-results"
                className={`sidebar-nav-item ${isLabResultsActive ? 'is-active' : ''}`}
              >
                <img
                  src="/images/hqh/imgFileHeart.svg"
                  className="sidebar-nav-icon"
                  width="20"
                  height="20"
                  alt=""
                />
                <span>Kết quả xét nghiệm</span>
              </Link>
              <Link
                to="/patient/medications"
                className={`sidebar-nav-item ${isPrescriptionActive ? 'is-active' : ''}`}
              >
                <img
                  src="/images/hqh/imgPill.svg"
                  className="sidebar-nav-icon"
                  width="20"
                  height="20"
                  alt=""
                />
                <span>Đơn thuốc</span>
              </Link>
            </>
          )}

          {session?.actorType === 'DOCTOR' && (
            <NavLink
              to="/doctor/clinical"
              className={({ isActive }) =>
                `sidebar-nav-item ${isActive ? 'is-active' : ''}`
              }
            >
              <Stethoscope className="sidebar-nav-icon" />
              <span>Bàn khám bác sĩ</span>
            </NavLink>
          )}

          {session?.actorType === 'DOCTOR' && (
            <NavLink
              to="/doctor/treatment"
              className={({ isActive }) =>
                `sidebar-nav-item ${isActive ? 'is-active' : ''}`
              }
            >
              <ClipboardList className="sidebar-nav-icon" aria-hidden="true" />
              <span>Chỉ định & kê đơn</span>
            </NavLink>
          )}
          {session?.actorType === 'STAFF' && (
            <>
              {session.capabilities.includes('RECEPTION') && (
                <NavLink
                  to="/staff/reception"
                  className={({ isActive }) =>
                    `sidebar-nav-item ${isActive ? 'is-active' : ''}`
                  }
                >
                  <img
                    src="/images/hqh/imgContactRound.svg"
                    className="sidebar-nav-icon"
                    width="20"
                    height="20"
                    alt=""
                  />
                  <span>Quầy tiếp nhận</span>
                </NavLink>
              )}
              {session.capabilities.includes('CASHIER') && (
                <NavLink
                  to="/staff/cashier"
                  className={({ isActive }) =>
                    `sidebar-nav-item ${isActive ? 'is-active' : ''}`
                  }
                >
                  <Receipt className="sidebar-nav-icon" />
                  <span>Thu ngân & viện phí</span>
                </NavLink>
              )}
              {session.capabilities.includes('PHARMACY') && (
                <NavLink
                  to="/staff/pharmacy"
                  className={({ isActive }) =>
                    `sidebar-nav-item ${isActive ? 'is-active' : ''}`
                  }
                >
                  <img
                    src="/images/hqh/imgPill.svg"
                    className="sidebar-nav-icon"
                    width="20"
                    height="20"
                    alt=""
                  />
                  <span>Quầy dược</span>
                </NavLink>
              )}
              {session.capabilities.some(
                (c) => c === 'LAB_TECH' || c === 'LAB_REVIEW',
              ) && (
                <NavLink
                  to="/staff/diagnostic"
                  className={({ isActive }) =>
                    `sidebar-nav-item ${isActive ? 'is-active' : ''}`
                  }
                >
                  <FlaskConical className="sidebar-nav-icon" />
                  <span>Phòng xét nghiệm</span>
                </NavLink>
              )}
              {session.capabilities.includes('ADMIN') && (
                <>
                  <NavLink
                    to="/staff/schedules"
                    className={({ isActive }) =>
                      `sidebar-nav-item ${isActive ? 'is-active' : ''}`
                    }
                  >
                    <CalendarClock className="sidebar-nav-icon" />
                    <span>Quản trị ca khám</span>
                  </NavLink>
                  <NavLink
                    to="/staff/summary"
                    className={({ isActive }) =>
                      `sidebar-nav-item ${isActive ? 'is-active' : ''}`
                    }
                  >
                    <LayoutDashboard className="sidebar-nav-icon" />
                    <span>Tổng hợp vận hành</span>
                  </NavLink>
                </>
              )}
            </>
          )}
        </nav>

        <div className="sidebar-support-card">
          <p className="support-title">Luôn sẵn sàng hỗ trợ</p>
          <p className="support-hotline">1900 7178</p>
          <a
            href="#"
            className="support-link"
            onClick={(e) => e.preventDefault()}
          >
            Hướng dẫn sử dụng →
          </a>
        </div>

        {session ? (
          <button
            type="button"
            onClick={() => logoutUser()}
            className="sidebar-logout-btn"
          >
            Đăng xuất
          </button>
        ) : (
          <Link
            to="/login"
            className="sidebar-logout-btn"
            style={{ color: 'var(--primary)' }}
          >
            Đăng nhập
          </Link>
        )}
      </aside>

      <div className="app-main-container">
        <header className="app-header">
          <span className="header-tagline" aria-label="Vị trí hiện tại">
            {workspaceLabel[pathname] ?? 'Không gian sức khỏe của bạn'}
          </span>
          <div className="header-right">
            <span className="header-date">{formatCurrentDateVi()}</span>
            <button
              type="button"
              className="header-bell-btn"
              aria-label="Thông báo"
            >
              <img
                src="/images/hqh/imgBell.svg"
                width="20"
                height="20"
                alt=""
              />
            </button>
            <div className="header-user-profile">
              <span className="header-user-name">
                {session?.userId
                  ? `Người dùng #${session.userId.slice(-6)}`
                  : 'Chưa đăng nhập'}
              </span>
              <span className="header-user-role">{roleCaption}</span>
            </div>
          </div>
        </header>

        <main className="app-content">
          <div
            key={location.pathname + location.search}
            className="page-transition-enter"
          >
            <Outlet />
          </div>
        </main>

        <footer className="app-footer">
          <span>HQH Care © 2026 · Bảo mật thông tin người bệnh</span>
        </footer>
      </div>
    </div>
  );
}

function ProfileDetailRoute({ api }: { api: PatientApi }) {
  const { patientId = '' } = useParams();
  return <ProfileDetail api={api} patientId={patientId} />;
}

function ProfileEditRoute({ api }: { api: PatientApi }) {
  const { patientId = '' } = useParams();
  const [profile, setProfile] =
    useState<Awaited<ReturnType<PatientApi['getById']>>>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    const controller = new AbortController();
    api.getById(patientId, controller.signal).then(setProfile, setError);
    return () => controller.abort();
  }, [api, patientId]);
  if (error)
    return (
      <section className="page-content">
        <p role="alert">Không tải được hồ sơ.</p>
      </section>
    );
  if (!profile)
    return (
      <section className="page-content">
        <p role="status">Đang tải hồ sơ…</p>
      </section>
    );
  return <ProfileForm api={api} initial={profile} />;
}

function PharmacyAccess({ session }: { session?: WebRuntime['session'] }) {
  if (
    session?.actorType !== 'STAFF' ||
    !session.capabilities.includes('PHARMACY')
  )
    return (
      <section className="state-card state-error" role="alert">
        <h1>Không đủ quyền</h1>
        <p>Tài khoản chưa được cấp quyền dược.</p>
      </section>
    );
  return <Outlet key={session.userId} />;
}
function PharmacyDetailRoute({ api }: { api: PharmacyApi }) {
  const { prescriptionId = '' } = useParams();
  return (
    <PrescriptionDetail
      key={prescriptionId}
      api={api}
      prescriptionId={prescriptionId}
    />
  );
}

function CashierQueueRoute({ session }: { session?: WebRuntime['session'] }) {
  if (session && !session.capabilities.includes('CASHIER')) {
    return (
      <section role="alert" className="error-panel" style={{ margin: '24px' }}>
        Tài khoản nhân viên không có quyền truy cập module Thu ngân & viện phí
        (CASHIER).
      </section>
    );
  }

  return (
    <section className="patient-page-layout" aria-labelledby="cashier-heading">
      <div className="patient-header-banner">
        <span className="page-eyebrow">QUẦY THU NGÂN</span>
        <h1 id="cashier-heading" className="page-title">
          Thu ngân & viện phí
        </h1>
        <p className="page-subtitle">
          Quản lý hàng chờ khoản thu, xác nhận thanh toán tại quầy và xuất biên
          nhận viện phí.
        </p>
      </div>

      <div className="patient-master-detail">
        <aside className="family-panel" aria-label="Hàng chờ viện phí">
          <h2 className="family-panel-title">Hàng chờ khoản thu</h2>
          <p className="family-panel-subtitle">0 khoản thu chờ thanh toán</p>
          <div className="empty-state" style={{ padding: '24px 12px' }}>
            <p style={{ fontSize: '13px', color: 'var(--muted)' }}>
              Hiện không có khoản thu nào đang chờ xử lý tại quầy.
            </p>
          </div>
        </aside>

        <main className="profile-detail-panel" aria-label="Chi tiết giao dịch">
          <div className="profile-detail-header">
            <div>
              <h2 className="profile-detail-title">
                Xử lý thanh toán viện phí
              </h2>
              <p className="profile-detail-subtitle">
                Chọn khoản thu từ hàng chờ bên trái để kiểm tra chi tiết và thực
                hiện thu tiền.
              </p>
            </div>
          </div>
        </main>
      </div>
    </section>
  );
}

function CatalogRoute({
  api,
  session,
}: {
  api: CatalogApi;
  session?: WebRuntime['session'];
}) {
  const navigate = useNavigate();
  return (
    <CatalogPage
      api={api}
      session={
        session
          ? {
              actorType: session.actorType,
              capabilities: session.capabilities,
            }
          : undefined
      }
      onChooseDoctor={(id) =>
        navigate(`/patient/appointments/new?doctorId=${encodeURIComponent(id)}`)
      }
      onChooseService={(id) =>
        navigate(
          `/patient/appointments/new?serviceId=${encodeURIComponent(id)}`,
        )
      }
    />
  );
}

function AppRoutes({
  patientApi,
  appointmentApi,
  catalogApi,
  clinicalApi,
  diagnosticApi,
  pharmacyApi,
  billingApi,
  session,
}: {
  patientApi: PatientApi;
  appointmentApi: AppointmentApi;
  catalogApi: CatalogApi;
  clinicalApi: ClinicalApi;
  diagnosticApi: DiagnosticApi;
  pharmacyApi: PharmacyApi;
  billingApi: BillingApi;
  session?: WebRuntime['session'];
}) {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/register/verify" element={<VerifyOtpPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/forgot-password/reset" element={<ResetPasswordPage />} />

      <Route element={<AppLayout session={session} />}>
        <Route
          path="/"
          element={<Navigate to={homeForSession(session)} replace />}
        />
        <Route
          path="/patient/home"
          element={
            <PatientHome
              patientApi={
                session?.actorType === 'PATIENT' ? patientApi : undefined
              }
              appointmentApi={appointmentApi}
            />
          }
        />
        <Route
          path="/patient/profiles"
          element={<ProfileList api={patientApi} />}
        />
        <Route
          path="/patient/profiles/new"
          element={<ProfileForm api={patientApi} />}
        />
        <Route
          path="/patient/profiles/:patientId"
          element={<ProfileDetailRoute api={patientApi} />}
        />
        <Route
          path="/patient/profiles/:patientId/edit"
          element={<ProfileEditRoute api={patientApi} />}
        />
        <Route
          path="/catalog"
          element={<CatalogRoute api={catalogApi} session={session} />}
        />
        <Route
          path="/patient/appointments/new"
          element={
            <AvailableSlots
              api={appointmentApi}
              catalog={catalogApi}
              patientApi={
                session?.actorType === 'PATIENT' ? patientApi : undefined
              }
            />
          }
        />
        <Route
          path="/patient/appointments/review"
          element={
            <BookingReview
              api={appointmentApi}
              billingApi={billingApi}
            />
          }
        />
        <Route
          path="/patient/appointments"
          element={
            <MyAppointments api={appointmentApi} patientApi={patientApi} />
          }
        />
        <Route
          path="/staff/reception"
          element={
            session?.actorType === 'STAFF' &&
            session.capabilities.includes('RECEPTION') ? (
              <ReceptionQueue
                api={appointmentApi}
                patientApi={patientApi}
                catalog={catalogApi}
              />
            ) : (
              <section className="page-content" role="alert">
                Cần quyền tiếp đón để mở bàn tiếp nhận.
              </section>
            )
          }
        />
        <Route
          path="/staff/schedules"
          element={<ScheduleAdmin api={appointmentApi} />}
        />
        <Route
          path="/staff/summary"
          element={<AdminSummary api={appointmentApi} />}
        />
        <Route
          path="/staff/cashier"
          element={<CashierQueueRoute session={session} />}
        />
        <Route element={<PharmacyAccess session={session} />}>
          <Route
            path="/staff/pharmacy"
            element={<PrescriptionQueue api={pharmacyApi} />}
          />
          <Route
            path="/staff/pharmacy/stock"
            element={<StockPage api={pharmacyApi} />}
          />
          <Route
            path="/staff/pharmacy/stock/adjust"
            element={
              <StockPage api={pharmacyApi} catalog={catalogApi} adjust />
            }
          />
          <Route
            path="/staff/pharmacy/prescriptions"
            element={<PrescriptionQueue api={pharmacyApi} />}
          />
          <Route
            path="/staff/pharmacy/prescriptions/:prescriptionId"
            element={<PrescriptionQueue api={pharmacyApi} />}
          />
        </Route>
        <Route
          path="/patient/medications"
          element={
            session?.actorType === 'PATIENT' ? (
              <PatientMedicationStatus key={session.userId} api={pharmacyApi} />
            ) : (
              <section role="alert">
                Vui lòng đăng nhập bằng tài khoản bệnh nhân.
              </section>
            )
          }
        />
        <Route
          path="/doctor/treatment"
          element={
            <ClinicalRoute
              api={clinicalApi}
              diagnosticApi={diagnosticApi}
              session={session}
              view="treatment"
            />
          }
        />
        <Route
          path="/patient/lab-results"
          element={
            session?.actorType === 'PATIENT' ? (
              <PatientRecordsRoute
                patientApi={patientApi}
                clinicalApi={clinicalApi}
                diagnosticApi={diagnosticApi}
                kind="results"
              />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/patient/medical-records"
          element={
            session?.actorType === 'PATIENT' ? (
              <PatientRecordsRoute
                patientApi={patientApi}
                clinicalApi={clinicalApi}
                diagnosticApi={diagnosticApi}
                kind="records"
              />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/doctor/clinical"
          element={
            <ClinicalRoute
              api={clinicalApi}
              diagnosticApi={diagnosticApi}
              session={
                session
                  ? { userId: session.userId, actorType: session.actorType }
                  : undefined
              }
            />
          }
        />
        <Route
          path="/staff/diagnostic"
          element={
            <DiagnosticFeature
              api={diagnosticApi}
              session={
                session
                  ? {
                      userId: session.userId,
                      actorType: session.actorType,
                      capabilities: session.capabilities,
                    }
                  : undefined
              }
            />
          }
        />
        <Route
          path="/patient/appointments/:appointmentId"
          element={<AppointmentDetail api={appointmentApi} />}
        />
        <Route
          path="/patient/appointments/:appointmentId/reschedule"
          element={<AppointmentDetail api={appointmentApi} mode="reschedule" />}
        />
        <Route
          path="/patient/appointments/:appointmentId/cancel"
          element={<AppointmentDetail api={appointmentApi} mode="cancel" />}
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

export function App({ runtime: propRuntime }: { runtime?: WebRuntime } = {}) {
  const [activeRuntime, setActiveRuntime] = useState<WebRuntime>(
    propRuntime ?? getWebRuntime(),
  );

  useEffect(() => {
    if (propRuntime) {
      setActiveRuntime(propRuntime);
      return;
    }
    return subscribeWebRuntime(setActiveRuntime);
  }, [propRuntime]);

  const runtime = propRuntime ?? activeRuntime;
  const transport = runtime?.transport ?? noAdapter;
  const apiTransport = useMemo(
    () =>
      runtime
        ? withAuthRedirect(runtime.transport, runtime.onUnauthorized)
        : transport,
    [
      runtime,
      transport,
      runtime?.session?.userId,
      runtime?.session?.tokenVersion,
    ],
  );
  const patientApi = useMemo(
    () =>
      createPatientApi(apiTransport, {
        authorizationLease: runtime?.session?.lease,
      }),
    [apiTransport, runtime?.session?.lease],
  );
  const appointmentApi = useMemo(
    () => createAppointmentApi(apiTransport, runtime?.session?.lease),
    [apiTransport, runtime?.session?.lease],
  );
  const catalogApi = useMemo(
    () => createCatalogApi(apiTransport),
    [apiTransport],
  );
  const clinicalApi = useMemo(
    () =>
      createClinicalApi(apiTransport, {
        authorizationLease: runtime?.session?.lease
          ? (action) => runtime.session!.lease!(action)
          : undefined,
      }),
    [apiTransport, runtime?.session?.lease],
  );
  const diagnosticApi = useMemo(
    () =>
      createDiagnosticApi(apiTransport, {
        authorizationLease: runtime?.session?.lease,
      }),
    [apiTransport, runtime?.session?.lease],
  );
  const pharmacyApi = useMemo(
    () =>
      createPharmacyApi(apiTransport, {
        authorizationLease: runtime?.session?.lease,
      }),
    [apiTransport, runtime?.session?.lease],
  );
  const billingApi = useMemo(
    () => createBillingApi(apiTransport, runtime?.session?.lease),
    [apiTransport, runtime?.session?.lease],
  );
  return (
    <BrowserRouter>
      <AppRoutes
        key={runtime?.session?.userId || 'public'}
        patientApi={patientApi}
        appointmentApi={appointmentApi}
        catalogApi={catalogApi}
        clinicalApi={clinicalApi}
        diagnosticApi={diagnosticApi}
        pharmacyApi={pharmacyApi}
        billingApi={billingApi}
        session={runtime?.session}
      />
    </BrowserRouter>
  );
}

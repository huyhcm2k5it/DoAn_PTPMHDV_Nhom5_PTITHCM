import { useMemo } from "react";
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";
import { createPatientApi } from "../features/patient/api";
import type { PatientApi } from "../features/patient/types";
import { ProfileList } from "../features/patient/pages/ProfileList";
import { ProfileDetail } from "../features/patient/pages/ProfileDetail";
import { createAppointmentApi } from "../features/appointment/api";
import type { AppointmentApi } from "../features/appointment/types";
import { AvailableSlots } from "../features/appointment/pages/AvailableSlots";
import { BookingReview } from "../features/appointment/pages/BookingReview";
import { MyAppointments } from "../features/appointment/pages/MyAppointments";
import { AppointmentDetail } from "../features/appointment/pages/AppointmentDetail";
import { createCatalogApi } from "../features/catalog/api";
import type { CatalogApi } from "../features/catalog/types";
import { withAuthRedirect } from "./runtime";
import type { WebRuntime } from "./runtime";
import "./app.css";

const noAdapter = async (): Promise<Response> => {
  throw new Error("Shared API/session adapter của Hưng chưa được nạp vào web shell.");
};

function AppLayout() {
  return <div className="app-shell"><header className="app-header"><Link className="brand" to="/patient/profiles"><span className="brand-mark" aria-hidden="true">U</span><span>UMC <strong>Care</strong></span></Link><span className="header-caption">CHĂM SÓC SỨC KHỎE</span></header><div className="app-body"><aside className="app-sidebar"><p className="nav-label">BỆNH NHÂN</p><nav aria-label="Điều hướng chính"><Link to="/patient/profiles">Hồ sơ của tôi</Link><Link to="/patient/appointments/new">Tra cứu lịch khám</Link><Link to="/patient/appointments">Lịch hẹn</Link></nav><div className="sidebar-help"><span className="help-icon" aria-hidden="true">i</span><p>Thanh toán và trạng thái lịch được xác nhận từ máy chủ.</p></div></aside><main className="app-main"><Outlet /></main></div><footer className="app-footer">UMC Care · Cổng chăm sóc sức khỏe</footer></div>;
}

function ProfileDetailRoute({ api }: { api: PatientApi }) {
  const { patientId = "" } = useParams();
  return <ProfileDetail api={api} patientId={patientId} />;
}

function AppRoutes({ patientApi, appointmentApi, catalogApi }: { patientApi: PatientApi; appointmentApi: AppointmentApi; catalogApi: Pick<CatalogApi, "departments" | "doctors" | "services"> }) {
  return <Routes><Route element={<AppLayout />}><Route path="/" element={<Navigate to="/patient/profiles" replace />} /><Route path="/patient/profiles" element={<ProfileList api={patientApi} />} /><Route path="/patient/profiles/:patientId" element={<ProfileDetailRoute api={patientApi} />} /><Route path="/patient/appointments/new" element={<AvailableSlots api={appointmentApi} catalog={catalogApi} />} /><Route path="/patient/appointments/review" element={<BookingReview api={appointmentApi} />} /><Route path="/patient/appointments" element={<MyAppointments api={appointmentApi} />} /><Route path="/patient/appointments/:appointmentId" element={<AppointmentDetail api={appointmentApi} />} /><Route path="*" element={<section className="page-content"><h1>Không tìm thấy trang</h1><Link to="/patient/profiles">Về hồ sơ bệnh nhân</Link></section>} /></Route></Routes>;
}

export function App({ runtime }: { runtime?: WebRuntime }) {
  const transport = runtime?.transport ?? noAdapter;
  const apiTransport = useMemo(() => runtime ? withAuthRedirect(runtime.transport, runtime.onUnauthorized) : transport, [runtime, transport]);
  const patientApi = useMemo(() => createPatientApi(apiTransport), [apiTransport]);
  const appointmentApi = useMemo(() => createAppointmentApi(apiTransport), [apiTransport]);
  const catalogApi = useMemo(() => createCatalogApi(apiTransport), [apiTransport]);
  return <BrowserRouter><AppRoutes patientApi={patientApi} appointmentApi={appointmentApi} catalogApi={catalogApi} /></BrowserRouter>;
}

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PatientApi, PatientProfile } from "../types";
import { Loading } from "../../../shared/ui/Loading";
import { ErrorPanel } from "../../../shared/ui/ErrorPanel";

export function ProfileDetail({ api, patientId }: { api: PatientApi; patientId: string }) {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ loading: boolean; data?: PatientProfile; error?: unknown }>({ loading: true });
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    setState({ loading: true });
    api.getById(patientId, controller.signal).then(
      (data) => { if (current) setState({ loading: false, data }); },
      (error) => { if (current && !controller.signal.aborted) setState({ loading: false, error }); },
    );
    return () => { current = false; controller.abort(); };
  }, [api, patientId, retry]);
  return <section className="page-content" aria-labelledby="profile-heading"><Link className="back-link" to="/patient/profiles">← Danh sách hồ sơ</Link>{state.loading ? <Loading label="Đang tải chi tiết hồ sơ" /> : state.error ? <ErrorPanel error={state.error} onRetry={() => setRetry((value) => value + 1)} /> : state.data ? <><div className="page-heading"><div><p className="eyebrow">CHI TIẾT HỒ SƠ</p><h1 id="profile-heading">{state.data.fullName}</h1><p>{state.data.relation === "SELF" ? "Hồ sơ của tôi" : "Hồ sơ được liên kết"}</p></div><span className="status-pill">Đang hoạt động</span></div><dl className="detail-grid"><div><dt>Ngày sinh</dt><dd>{state.data.birthDate}</dd></div><div><dt>Giới tính</dt><dd>{state.data.sex || "Chưa cập nhật"}</dd></div><div><dt>Số điện thoại liên hệ</dt><dd>{state.data.contactPhone || "Chưa cập nhật"}</dd></div><div><dt>Địa chỉ</dt><dd>{state.data.address || "Chưa cập nhật"}</dd></div><div><dt>Thông tin BHYT tự khai</dt><dd>{state.data.bhytSelfDeclared || "Chưa cập nhật"}</dd></div></dl></> : null}</section>;
}
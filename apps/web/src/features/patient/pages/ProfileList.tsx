import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PatientApi, PatientPage } from "../types";
import { Loading } from "../../../shared/ui/Loading";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { ErrorPanel } from "../../../shared/ui/ErrorPanel";

export function ProfileList({ api }: { api: PatientApi }) {
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ loading: boolean; data?: PatientPage; error?: unknown }>({ loading: true });
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setState({ loading: true });
    api.list(page, 20, controller.signal).then(
      (data) => { if (current) setState({ loading: false, data }); },
      (error) => { if (current && !controller.signal.aborted) setState({ loading: false, error }); },
    );
    return () => { current = false; controller.abort(); };
  }, [api, page, retry]);

  return <section className="page-content" aria-labelledby="profiles-heading">
    <div className="page-heading"><div><p className="eyebrow">HỒ SƠ CỦA BẠN</p><h1 id="profiles-heading">Hồ sơ bệnh nhân</h1><p>Chọn hồ sơ để xem thông tin cá nhân đã đăng ký.</p></div><span className="page-count">{state.data?.total ?? 0} hồ sơ</span></div>
    {state.loading ? <Loading label="Đang tải hồ sơ" /> : state.error ? <ErrorPanel error={state.error} onRetry={() => setRetry((value) => value + 1)} /> : state.data?.items.length === 0 ? <EmptyState title="Bạn chưa có hồ sơ nào" description="Hồ sơ được liên kết với tài khoản sẽ xuất hiện tại đây." /> : <>
      <div className="profile-grid">{state.data?.items.map((profile) => <article className="profile-card" key={profile.id}><div className="profile-avatar" aria-hidden="true">{profile.fullName.trim().charAt(0).toLocaleUpperCase("vi-VN")}</div><div className="profile-card-copy"><p className="eyebrow">{profile.relation === "SELF" ? "HỒ SƠ CỦA TÔI" : "HỒ SƠ ĐƯỢC LIÊN KẾT"}</p><h2>{profile.fullName}</h2><p>Ngày sinh: {profile.birthDate}</p></div><Link className="text-link" to={`/patient/profiles/${encodeURIComponent(profile.id)}`}>Xem hồ sơ <span aria-hidden="true">→</span></Link></article>)}</div>
      <nav className="pagination" aria-label="Phân trang hồ sơ"><button type="button" className="button button-secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Trang trước</button><span>Trang {page}</span><button type="button" className="button button-secondary" disabled={(state.data?.items.length ?? 0) < 20 || (state.data?.items.length ?? 0) >= (state.data?.total ?? 0)} onClick={() => setPage((value) => value + 1)}>Trang sau</button></nav>
    </>}
  </section>;
}
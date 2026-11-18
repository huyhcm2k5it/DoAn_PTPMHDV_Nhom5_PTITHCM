import type { PatientApi, PatientProfile } from '../../patient/types';
import { appointmentLabels, formatAppointmentTime } from '../display';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AppointmentApi, AppointmentSummary } from '../types';
import { Loading } from '../../../shared/ui/Loading';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
export function MyAppointments({
  api,
  patientApi,
}: {
  api: AppointmentApi;
  patientApi?: PatientApi;
}) {
  const [params] = useSearchParams();
  const [patientId, setPatientId] = useState(params.get('patientId') ?? '');
  const [items, setItems] = useState<AppointmentSummary[]>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const [profiles, setProfiles] = useState<PatientProfile[]>();
  const [profileError, setProfileError] = useState<unknown>();
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [retry, setRetry] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  useEffect(() => {
    if (!patientApi) return;
    const controller = new AbortController();
    patientApi.list(1, 100, controller.signal).then(
      ({ items }) => {
        if (controller.signal.aborted) return;
        const active = items.filter((item) => item.active !== false);
        setProfiles(active);
        setPatientId((value) =>
          active.some((item) => item.id === value)
            ? value
            : (active.find((item) => item.relation === 'SELF')?.id ??
              active[0]?.id ??
              ''),
        );
      },
      (error) => {
        if (!controller.signal.aborted) setProfileError(error);
      },
    );
    return () => controller.abort();
  }, [patientApi]);
  useEffect(() => {
    if (!patientApi || !patientId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    api
      .listAppointments(patientId, controller.signal, {
        page: String(page),
        ...(filter === 'all' ? {} : { state: filter }),
      })
      .then(
        (result) => {
          if (!controller.signal.aborted) {
            setItems(result.items);
            setTotal(result.total);
            setLoading(false);
          }
        },
        (error) => {
          if (!controller.signal.aborted) {
            setError(error);
            setLoading(false);
          }
        },
      );
    return () => controller.abort();
  }, [api, patientApi, patientId, page, filter, retry]);
  const visible = items?.filter(
    (item) => filter === 'all' || item.state === filter,
  );
  const selected =
    visible?.find((item) => item.appointmentId === selectedId) ?? visible?.[0];
  const patientName =
    profiles?.find((profile) => profile.id === patientId)?.fullName ??
    patientId;
  async function load(event?: React.FormEvent) {
    event?.preventDefault();
    if (!patientId) return;
    setLoading(true);
    setError(undefined);
    try {
      setItems((await api.listAppointments(patientId)).items);
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="page-content quan-workflow">
      <div className="page-heading">
        <div>
          <p className="eyebrow">LỊCH CỦA TÔI</p>
          <h1>Lịch khám của tôi</h1>
          <p>Theo dõi trạng thái lịch và đồng bộ thanh toán từ máy chủ.</p>
        </div>
        <Link to="/patient/appointments/new" className="button button-primary">
          Đặt lịch khám mới
        </Link>
      </div>
      {profileError != null && <ErrorPanel error={profileError} />}
      {patientApi ? (
        <div className="search-panel">
          <label>
            Người khám
            <select
              value={patientId}
              onChange={(event) => {
                setItems(undefined);
                setPage(1);
                setPatientId(event.target.value);
              }}
            >
              <option value="">
                {profiles ? 'Chọn hồ sơ' : 'Đang tải hồ sơ…'}
              </option>
              {profiles?.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.fullName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Trạng thái
            <select
              value={filter}
              onChange={(event) => {
                setPage(1);
                setFilter(event.target.value);
              }}
            >
              <option value="all">Tất cả</option>
              {Object.entries(appointmentLabels).map(([state, label]) => (
                <option key={state} value={state}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {profiles?.length === 0 && (
            <Link to="/patient/profiles/new">Tạo hồ sơ người khám</Link>
          )}
        </div>
      ) : (
        <form className="search-panel" onSubmit={load}>
          <label>
            Mã hồ sơ bệnh nhân
            <input
              required
              value={patientId}
              onChange={(event) => setPatientId(event.target.value)}
              placeholder="UUID hồ sơ"
            />
          </label>
          <button className="button button-primary" type="submit">
            Tải lịch hẹn
          </button>
        </form>
      )}
      {loading && <Loading label="Đang tải lịch hẹn" />}
      {!loading && error != null && (
        <ErrorPanel
          error={error}
          onRetry={
            patientApi ? () => setRetry((value) => value + 1) : () => load()
          }
        />
      )}
      {!loading && visible?.length === 0 && (
        <EmptyState
          title="Chưa có lịch hẹn"
          description="Các lịch đã tạo sẽ xuất hiện ở đây."
        />
      )}
      {!loading && (visible?.length ?? 0) > 0 && (
        <div className="appointments-layout">
          <div className="state-card appointments-list">
            {visible?.map((item) => (
              <article className="appointment-card" key={item.appointmentId}>
                <div className="profile-card-copy">
                  <p className="status-pill">
                    {appointmentLabels[item.state] ?? item.state}
                  </p>
                  <p className="field-hint">Mã lịch: {item.appointmentId}</p>
                  <h2>{patientName}</h2>
                  <p>{formatAppointmentTime(item.appointment?.startAt)}</p>
                </div>
                <Link
                  className="text-link"
                  to={`/patient/appointments/${encodeURIComponent(item.appointmentId)}`}
                >
                  Xem chi tiết
                </Link>
                <button
                  className="button button-primary"
                  onClick={() => setSelectedId(item.appointmentId)}
                >
                  Xem vé khám
                </button>
              </article>
            ))}
          </div>
          <aside className="state-card appointment-ticket">
            <h2>Vé khám điện tử</h2>
            {selected && (
              <>
                <span className="status-pill">
                  {appointmentLabels[selected.state] ?? selected.state}
                </span>
                <p className="ticket-code">{selected.appointmentId}</p>
                <h3>{patientName}</h3>
                <p>{formatAppointmentTime(selected.appointment?.startAt)}</p>
                <p>
                  Hồ sơ: {String(selected.appointment?.patientId ?? patientId)}
                </p>
                {selected.state === 'CONFIRMED' && (
                  <p>
                    Đến quầy lễ tân trước giờ hẹn để check-in và cấp số khám.
                  </p>
                )}
                <Link
                  className="button button-secondary"
                  to={
                    '/patient/appointments/' +
                    encodeURIComponent(selected.appointmentId)
                  }
                >
                  Mở chi tiết lịch khám
                </Link>
              </>
            )}
          </aside>
        </div>
      )}
      {patientApi && patientId && !error && (page > 1 || total > 20) && (
        <nav className="pagination" aria-label="Phân trang lịch khám">
          <button
            className="button button-secondary"
            disabled={loading || page === 1}
            onClick={() => setPage((value) => value - 1)}
          >
            Trang trước
          </button>
          <span>Trang {page}</span>
          <button
            className="button button-secondary"
            disabled={loading || page * 20 >= total}
            onClick={() => setPage((value) => value + 1)}
          >
            Trang sau
          </button>
        </nav>
      )}
    </section>
  );
}

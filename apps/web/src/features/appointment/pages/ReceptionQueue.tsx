import { useSearchParams } from 'react-router-dom';
import type { PatientApi, PatientProfile } from '../../patient/types';
import type { CatalogApi } from '../../catalog/types';
import { formatAppointmentTime } from '../display';
import { AvailableSlots } from './AvailableSlots';
import { useEffect, useRef, useState } from 'react';
import type { AppointmentApi, AppointmentSummary, QueueTicket } from '../types';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import { Loading } from '../../../shared/ui/Loading';

export function ReceptionQueue({
  api,
  patientApi,
  catalog,
}: {
  api: AppointmentApi;
  patientApi?: PatientApi;
  catalog?: CatalogApi;
}) {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'r01';
  const [lookup, setLookup] = useState('');
  const [profiles, setProfiles] = useState<PatientProfile[]>();
  const [selected, setSelected] = useState<PatientProfile>();
  const [appointments, setAppointments] = useState<AppointmentSummary[]>();
  const [appointment, setAppointment] = useState<AppointmentSummary>();
  const [ticket, setTicket] = useState<QueueTicket>();
  const [checkKey, setCheckKey] = useState<string>();
  const lookupLock = useRef(false);
  const queueVisible = tab === 'r04' || tab === 'r05';
  const [items, setItems] = useState<QueueTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [ticketType, setTicketType] = useState<'FIRST' | 'RETURN'>('FIRST');
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!queueVisible || !api.listQueue) return;
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    api
      .listQueue?.({ ticketType }, controller.signal)
      .then(
        (data) => {
          if (!controller.signal.aborted) setItems(data.items);
        },
        (error) => {
          if (!controller.signal.aborted) setError(error);
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, ticketType, reload, queueVisible]);
  async function callNext() {
    if (busy || !api.callNext) return;
    setBusy(true);
    setError(undefined);
    try {
      setTicket(await api.callNext?.({ ticketType }, crypto.randomUUID()));
      setReload((value) => value + 1);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  async function noShow(ticket: QueueTicket) {
    setBusy(true);
    setError(undefined);
    try {
      await api.noShow?.(
        ticket.ticketId,
        { reasonCode: 'PATIENT_ABSENT', expectedVersion: ticket.version },
        crypto.randomUUID(),
      );
      setReload((value) => value + 1);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  function openAppointment(item: AppointmentSummary) {
    setAppointment(item);
    setTicket(undefined);
    setCheckKey(undefined);
    setParams({ tab: 'r01' });
  }
  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (lookupLock.current || lookup.trim().length < 2) return;
    lookupLock.current = true;
    setBusy(true);
    setError(undefined);
    setProfiles(undefined);
    setSelected(undefined);
    setAppointments(undefined);
    try {
      const query = lookup.trim();
      if (
        tab === 'r01' &&
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(query)
      ) {
        try {
          openAppointment(await api.getAppointment(query));
          return;
        } catch (caught) {
          if ((caught as { status?: number }).status !== 404) throw caught;
        }
      }
      if (patientApi?.search)
        setProfiles((await patientApi.search(query)).items);
    } catch (caught) {
      setError(caught);
    } finally {
      lookupLock.current = false;
      setBusy(false);
    }
  }
  async function chooseProfile(profile: PatientProfile) {
    setSelected(profile);
    if (tab === 'r02') return;
    setError(undefined);
    setAppointments(undefined);
    setBusy(true);
    try {
      setAppointments((await api.listAppointments(profile.id)).items);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  const version = Number(appointment?.appointment?.version);
  async function checkIn() {
    if (!api.checkIn || !appointment || busy || !version) return;
    const key = checkKey ?? crypto.randomUUID();
    setCheckKey(key);
    setBusy(true);
    setError(undefined);
    try {
      setTicket(await api.checkIn(appointment.appointmentId, version, key));
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  const tabs = {
    r01: 'Bàn tiếp đón',
    r02: 'Đặt lịch hộ',
    r03: 'Check-in',
    r04: 'Hàng đợi phòng khám',
    r05: 'Điều phối lượt khám',
  };
  return (
    <section className="page-content quan-workflow reception-design">
      <div className="page-heading">
        <div>
          <p className="eyebrow">KHÔNG GIAN LÀM VIỆC</p>
          <h1>Tiếp nhận bệnh nhân</h1>
          <p>Quản lý lịch hẹn và tiếp nhận nhanh tại quầy.</p>
        </div>
      </div>
      <nav className="quan-tabs" aria-label="Nghiệp vụ tiếp đón">
        {Object.entries(tabs).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={
              'button ' + (tab === id ? 'button-primary' : 'button-secondary')
            }
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => {
              setError(undefined);
              setProfiles(undefined);
              setSelected(undefined);
              setAppointments(undefined);
              setTicket(undefined);
              setParams({ tab: id });
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {!queueVisible && (
        <>
          {error != null && <ErrorPanel error={error} />}
          {(tab === 'r01' || tab === 'r02') && (
            <>
              <h1>
                {tab === 'r01' ? 'Tra cứu người bệnh' : 'Đặt lịch hộ tại quầy'}
              </h1>
              <form className="search-panel" onSubmit={search}>
                <label>
                  {tab === 'r01'
                    ? 'Mã lịch hẹn, số điện thoại hoặc tên người khám'
                    : 'Số điện thoại hoặc tên người khám'}
                  <input
                    required
                    minLength={2}
                    value={lookup}
                    onChange={(event) => setLookup(event.target.value)}
                  />
                </label>
                <button className="button button-primary" disabled={busy}>
                  Tra cứu
                </button>
              </form>
              {profiles?.length === 0 && <p>Không tìm thấy hồ sơ phù hợp.</p>}
              <div className="quan-list">
                {profiles?.map((profile) => (
                  <article className="state-card quan-actions" key={profile.id}>
                    <strong>{profile.fullName}</strong>{' '}
                    <span>{profile.contactPhone}</span>
                    <button
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() => void chooseProfile(profile)}
                    >
                      {tab === 'r01' ? 'Xem lịch hẹn' : 'Chọn hồ sơ'}
                    </button>
                  </article>
                ))}
              </div>
              {tab === 'r01' && appointments?.length === 0 && (
                <p>Hồ sơ chưa có lịch hẹn.</p>
              )}
              {tab === 'r01' && appointments && appointments.length > 0 && (
                <section className="state-card reception-table">
                  <h2>Lịch hẹn của {selected?.fullName ?? 'người khám'}</h2>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Giờ hẹn</th>
                          <th>Mã đặt lịch</th>
                          <th>Người khám</th>
                          <th>Trạng thái</th>
                          <th>Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {appointments.map((item) => (
                          <tr key={item.appointmentId}>
                            <td>
                              {formatAppointmentTime(item.appointment?.startAt)}
                            </td>
                            <td>{item.appointmentId}</td>
                            <td>{selected?.fullName}</td>
                            <td>{item.state}</td>
                            <td>
                              <button
                                className="button button-secondary"
                                disabled={busy}
                                onClick={() => openAppointment(item)}
                              >
                                Tiếp nhận →
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {tab === 'r02' && selected && catalog && (
                <AvailableSlots
                  key={selected.id}
                  api={api}
                  catalog={catalog}
                  assistedPatient={selected}
                />
              )}
            </>
          )}
          {(tab === 'r03' || (tab === 'r01' && appointment)) && (
            <>
              <h2>Đối chiếu thông tin và cấp số khám</h2>
              {appointment ? (
                <section className="reception-checkin">
                  <div className="state-card">
                    <dl className="detail-grid">
                      <div>
                        <dt>Mã lịch</dt>
                        <dd>{appointment.appointmentId}</dd>
                      </div>
                      <div>
                        <dt>Giờ khám</dt>
                        <dd>
                          {formatAppointmentTime(
                            appointment.appointment?.startAt,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Trạng thái</dt>
                        <dd>{appointment.state}</dd>
                      </div>
                      <div>
                        <dt>Hồ sơ</dt>
                        <dd>
                          {String(appointment.appointment?.patientId ?? '')}
                        </dd>
                      </div>
                    </dl>
                    {ticket ? (
                      <p role="status">Đã tiếp nhận · {ticket.ticketType}</p>
                    ) : (
                      <button
                        className="button button-primary"
                        disabled={
                          busy || !version || appointment.state !== 'CONFIRMED'
                        }
                        onClick={() => void checkIn()}
                      >
                        Xác nhận check-in
                      </button>
                    )}
                  </div>
                  <aside className="state-card checkin-ticket">
                    <h3>PHIẾU KHÁM NGOẠI TRÚ</h3>
                    <strong>{ticket ? ticket.ticketId : '—'}</strong>
                    <p>
                      {formatAppointmentTime(appointment.appointment?.startAt)}
                    </p>
                    <p>
                      {ticket
                        ? 'Đã check-in thành công.'
                        : 'Chỉ cấp lượt khám sau khi check-in thành công.'}
                    </p>
                  </aside>
                </section>
              ) : (
                <p>Chọn một lịch hẹn từ bàn tiếp đón.</p>
              )}
            </>
          )}
        </>
      )}
      {queueVisible && (
        <>
          <div className="page-heading">
            <div>
              <p className="eyebrow">QUẦY TIẾP NHẬN</p>
              <h1>
                {tab === 'r05' ? 'Điều phối lượt khám' : 'Hàng đợi phòng khám'}
              </h1>
            </div>
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => void callNext()}
            >
              Gọi số tiếp
            </button>
          </div>
          {ticket && (
            <p role="status" className="state-card">
              Đã gọi lượt {ticket.ticketId} · {ticket.ticketType}
            </p>
          )}
          <label>
            Loại lượt khám
            <select
              value={ticketType}
              onChange={(event) =>
                setTicketType(event.target.value as 'FIRST' | 'RETURN')
              }
            >
              <option value="FIRST">Khám lần đầu</option>
              <option value="RETURN">Tái khám</option>
            </select>
          </label>
          {error != null && (
            <ErrorPanel
              error={error}
              onRetry={() => setReload((value) => value + 1)}
            />
          )}
          {loading ? (
            <Loading label="Đang tải hàng chờ" />
          ) : items.length === 0 ? (
            <p>Hàng chờ đang trống.</p>
          ) : (
            <ul className="quan-list quan-queue">
              {items.map((ticket) => (
                <li className="state-card quan-actions" key={ticket.ticketId}>
                  <strong>{ticket.ticketId.slice(0, 8)}</strong>
                  <span>{ticket.state}</span>
                  <span>{ticket.appointmentId}</span>
                  {['WAITING', 'CALLED'].includes(ticket.state) && (
                    <button
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() => void noShow(ticket)}
                    >
                      Đánh dấu vắng
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

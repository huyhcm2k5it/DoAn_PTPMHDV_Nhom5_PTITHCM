import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type {
  CatalogApi,
  Department,
  Doctor,
  MedicalService,
} from '../../catalog/types';
import type { AppointmentApi, AvailableSlot } from '../types';
import type { PatientApi, PatientProfile } from '../../patient/types';
import { BookingCalendar } from '../BookingCalendar';
import { Loading } from '../../../shared/ui/Loading';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import '../appointment.css';

const today = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(
    new Date(),
  );
const time = (value: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
const steps = [
  'Chuyên khoa và dịch vụ',
  'Bác sĩ và giờ khám',
  'Thông tin người khám',
  'Xác nhận và thanh toán',
];

export function AvailableSlots({
  api,
  catalog,
  patientApi,
  assistedPatient,
}: {
  api: AppointmentApi;
  catalog: Pick<CatalogApi, 'departments' | 'doctors' | 'services'>;
  patientApi?: PatientApi;
  assistedPatient?: PatientProfile;
}) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const step = Math.min(3, Math.max(1, Number(params.get('step')) || 1));
  const departmentId = params.get('departmentId') ?? '';
  const serviceId = params.get('serviceId') ?? '';
  const doctorId = params.get('doctorId') ?? '';
  const date = params.get('date') ?? today();
  const patientId = assistedPatient?.id ?? params.get('patientId') ?? '';
  const selectedSlotId = params.get('slotId') ?? '';
  const [departments, setDepartments] = useState<Department[]>();
  const [services, setServices] = useState<MedicalService[]>();
  const [doctors, setDoctors] = useState<Doctor[]>();
  const [doctorPage, setDoctorPage] = useState(1);
  const [doctorTotal, setDoctorTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [profiles, setProfiles] = useState<PatientProfile[]>();
  const [profileError, setProfileError] = useState<unknown>();
  const [catalogError, setCatalogError] = useState<unknown>();
  const [slotState, setSlotState] = useState<{
    key: string;
    items?: AvailableSlot[];
    error?: unknown;
  }>();
  const [revision, setRevision] = useState(0);
  const [holding, setHolding] = useState(false);
  const [holdError, setHoldError] = useState<unknown>();
  const intent = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  const holdLock = useRef(false);
  function choose(values: Record<string, string>, clear: string[] = []) {
    const next = new URLSearchParams(params);
    clear.forEach((key) => next.delete(key));
    Object.entries(values).forEach(([key, value]) =>
      value ? next.set(key, value) : next.delete(key),
    );
    setParams(next);
    setHoldError(undefined);
  }
  useEffect(() => {
    const c = new AbortController();
    setCatalogError(undefined);
    setServices(undefined);
    setDoctors(undefined);
    Promise.all([
      catalog.departments(c.signal),
      catalog.services(departmentId, c.signal),
      catalog.doctors(departmentId, doctorPage, c.signal),
    ]).then(
      ([ds, ss, dd]) => {
        if (c.signal.aborted) return;
        setDepartments(ds.filter((x) => x.status === 'ACTIVE'));
        setServices(ss.filter((x) => x.status === 'ACTIVE'));
        setDoctors(dd.items.filter((x) => x.status === 'ACTIVE'));
        setDoctorTotal(dd.total);
      },
      (error) => {
        if (!c.signal.aborted) setCatalogError(error);
      },
    );
    return () => c.abort();
  }, [catalog, departmentId, doctorPage, revision]);
  useEffect(() => {
    if (assistedPatient) {
      setProfiles([assistedPatient]);
      return;
    }
    if (!patientApi) return;
    const c = new AbortController();
    setProfiles(undefined);
    setProfileError(undefined);
    patientApi.list(1, 100, c.signal).then(
      (data) => {
        if (!c.signal.aborted)
          setProfiles(data.items.filter((x) => x.active !== false));
      },
      (error) => {
        if (!c.signal.aborted) setProfileError(error);
      },
    );
    return () => c.abort();
  }, [patientApi, assistedPatient, revision]);
  const slotKey = JSON.stringify([doctorId, serviceId, date]);
  useEffect(() => {
    if (!doctorId || !serviceId || !date) return;
    const c = new AbortController();
    setSlotState({ key: slotKey });
    api.listAvailable({ doctorId, serviceId, date }, c.signal).then(
      (items) => {
        if (!c.signal.aborted) setSlotState({ key: slotKey, items });
      },
      (error) => {
        if (!c.signal.aborted) setSlotState({ key: slotKey, error });
      },
    );
    return () => c.abort();
  }, [api, doctorId, serviceId, date, slotKey, revision]);
  const slots = slotState?.key === slotKey ? slotState.items : undefined;
  const slot = slots?.find((x) => x.slotId === selectedSlotId);
  const profile = profiles?.find((x) => x.id === patientId);
  const service = services?.find((x) => x.id === serviceId);
  const doctor = doctors?.find((x) => x.id === doctorId);
  async function continueBooking() {
    if (!slot || !profile || !service || holding || holdLock.current) return;
    holdLock.current = true;
    setHolding(true);
    setHoldError(undefined);
    const signature = JSON.stringify([patientId, slot.slotId]);
    if (intent.current?.signature !== signature)
      intent.current = { signature, key: crypto.randomUUID() };
    try {
      const hold = await api.createHold(
        { patientId, slotId: slot.slotId },
        intent.current.key,
      );
      const back = '/patient/appointments/new?' + params;
      navigate(
        '/patient/appointments/review?' +
          new URLSearchParams({ patientId, holdId: hold.holdId }),
        {
          state: {
            holdId: hold.holdId,
            patientId,
            expiresAt: hold.expiresAt,
            amountVnd: hold.priceSnapshot?.amountVnd,
            startAt: slot.startAt,
            patientName: profile.fullName,
            doctorName: doctor?.displayName,
            serviceName: service.name,
            departmentName: departments?.find(
              (x) => x.id === service.departmentId,
            )?.name,
            returnTo: assistedPatient ? '/staff/reception?tab=r02' : back,
          },
        },
      );
    } catch (error) {
      setHoldError(error);
    } finally {
      holdLock.current = false;
      setHolding(false);
    }
  }
  return (
    <section className="page-content quan-workflow booking-redesign">
      <header className="page-heading">
        <div>
          <p className="eyebrow">CHĂM SÓC SỨC KHỎE</p>
          <h1>Đặt lịch khám</h1>
          <p>Chọn dịch vụ, giờ khám và hồ sơ của người bệnh.</p>
        </div>
        <span className="status-pill">Bước {step} / 4</span>
      </header>
      <ol className="booking-progress" aria-label="Các bước đặt khám">
        {steps.map((label, i) => (
          <li key={label} aria-current={step === i + 1 ? 'step' : undefined}>
            <span>{step > i + 1 ? '✓' : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {catalogError ? (
        <ErrorPanel
          error={catalogError}
          onRetry={() => setRevision((x) => x + 1)}
        />
      ) : !services || !doctors || !departments ? (
        <Loading label="Đang tải danh mục khám" />
      ) : (
        <>
          {step === 1 && (
            <section className="state-card booking-step-panel">
              <h2>Chọn chuyên khoa và dịch vụ</h2>
              <p className="field-hint">
                Giá tham khảo từ danh mục. Khoản thu chính thức theo giá máy chủ
                tại thời điểm đặt.
              </p>
              <label>
                Chuyên khoa
                <select
                  value={departmentId}
                  onChange={(e) => {
                    setDoctorPage(1);
                    choose({ departmentId: e.target.value }, [
                      'serviceId',
                      'doctorId',
                      'slotId',
                    ]);
                  }}
                >
                  <option value="">Tất cả chuyên khoa</option>
                  {departments.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="booking-service-grid">
                {services.map((x) => (
                  <article
                    key={x.id}
                    className={
                      'booking-service-card' +
                      (serviceId === x.id ? ' is-selected' : '')
                    }
                  >
                    <span className="eyebrow">
                      {departments.find((d) => d.id === x.departmentId)?.name}
                    </span>
                    <h3>{x.name}</h3>
                    <p>
                      {x.price
                        ? x.price.amountVnd.toLocaleString('vi-VN') + ' ₫'
                        : 'Chưa có giá hiệu lực'}
                    </p>
                    <button
                      className="button button-primary"
                      disabled={!x.price}
                      onClick={() =>
                        choose(
                          {
                            serviceId: x.id,
                            departmentId: x.departmentId,
                            step: '2',
                          },
                          ['doctorId', 'slotId'],
                        )
                      }
                    >
                      Chọn dịch vụ
                    </button>
                  </article>
                ))}
              </div>
              {!services.length && <EmptyState title="Chưa có dịch vụ khám" />}
            </section>
          )}
          {step === 2 && (
            <>
              <button
                className="back-link"
                onClick={() => choose({ step: '1' })}
              >
                ← Chọn lại chuyên khoa và dịch vụ
              </button>
              <div className="booking-columns">
                <section className="state-card booking-step-panel">
                  <div className="page-heading">
                    <div>
                      <h2>Chọn bác sĩ</h2>
                      <p>{service?.name ?? 'Vui lòng chọn dịch vụ ở bước 1'}</p>
                    </div>
                  </div>
                  <label>
                    Tìm bác sĩ
                    <input
                      type="search"
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      placeholder="Nhập tên bác sĩ"
                    />
                  </label>
                  <div className="booking-doctor-list">
                    {doctors
                      .filter((x) =>
                        x.displayName
                          .toLocaleLowerCase('vi')
                          .includes(keyword.toLocaleLowerCase('vi')),
                      )
                      .map((x) => (
                        <button
                          key={x.id}
                          className={
                            'booking-doctor-card' +
                            (doctorId === x.id ? ' is-selected' : '')
                          }
                          aria-pressed={doctorId === x.id}
                          onClick={() => choose({ doctorId: x.id }, ['slotId'])}
                        >
                          <span className="doctor-monogram" aria-hidden="true">
                            {x.displayName
                              .trim()
                              .split(' ')
                              .at(-1)
                              ?.slice(0, 1)}
                          </span>
                          <span>
                            <strong>{x.displayName}</strong>
                            <small>
                              {
                                departments.find((d) => d.id === x.departmentId)
                                  ?.name
                              }
                            </small>
                          </span>
                          <span className="text-link">
                            {doctorId === x.id ? 'Đã chọn' : 'Chọn bác sĩ'}
                          </span>
                        </button>
                      ))}
                  </div>
                  <nav className="pagination">
                    <button
                      disabled={doctorPage === 1}
                      onClick={() => setDoctorPage((x) => x - 1)}
                    >
                      Trước
                    </button>
                    <span>Trang {doctorPage}</span>
                    <button
                      disabled={doctorPage * 20 >= doctorTotal}
                      onClick={() => setDoctorPage((x) => x + 1)}
                    >
                      Sau
                    </button>
                  </nav>
                </section>
                <aside className="state-card booking-step-panel">
                  <h2>Chọn ngày &amp; giờ</h2>
                  <BookingCalendar
                    value={date}
                    onChange={(value) => choose({ date: value }, ['slotId'])}
                  />
                  {doctorId && serviceId ? (
                    slotState?.error ? (
                      <ErrorPanel
                        error={slotState.error}
                        onRetry={() => setRevision((x) => x + 1)}
                      />
                    ) : !slots ? (
                      <Loading label="Đang tải giờ trống" />
                    ) : (
                      <>
                        <h3>Giờ khám còn trống</h3>
                        <div className="booking-slot-grid">
                          {slots
                            .filter((x) => x.remainingCapacity > 0)
                            .map((x) => (
                              <button
                                key={x.slotId}
                                className={
                                  selectedSlotId === x.slotId
                                    ? 'is-selected'
                                    : ''
                                }
                                aria-pressed={selectedSlotId === x.slotId}
                                onClick={() => choose({ slotId: x.slotId })}
                              >
                                {time(x.startAt)}
                              </button>
                            ))}
                        </div>
                        {!slots.length && (
                          <EmptyState title="Chưa có giờ trống trong ngày" />
                        )}
                      </>
                    )
                  ) : (
                    <p>Chọn bác sĩ để xem giờ trống.</p>
                  )}
                  <button
                    className="button button-primary booking-next"
                    disabled={!slot || !service}
                    onClick={() => choose({ step: '3' })}
                  >
                    Tiếp tục → Thông tin người khám
                  </button>
                </aside>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <button
                className="back-link"
                onClick={() => choose({ step: '2' })}
              >
                ← Quay lại bác sĩ và khung giờ
              </button>
              <div className="booking-columns">
                <section className="state-card booking-step-panel">
                  <h2>Thông tin người khám</h2>
                  <p>Chọn hồ sơ sẽ sử dụng cho lịch hẹn này.</p>
                  {profileError ? (
                    <ErrorPanel
                      error={profileError}
                      onRetry={() => setRevision((x) => x + 1)}
                    />
                  ) : !profiles ? (
                    <Loading label="Đang tải hồ sơ" />
                  ) : (
                    <div className="booking-profile-list">
                      {profiles.map((x) => (
                        <button
                          key={x.id}
                          className={
                            'booking-profile-option' +
                            (patientId === x.id ? ' is-selected' : '')
                          }
                          aria-pressed={patientId === x.id}
                          onClick={() => choose({ patientId: x.id })}
                        >
                          <strong>{x.fullName}</strong>
                          <span>
                            {x.relation === 'SELF' ? 'Bản thân' : 'Người thân'}{' '}
                            · {x.birthDate}
                          </span>
                          <small>
                            {patientId === x.id
                              ? 'Đã chọn người khám'
                              : 'Chọn hồ sơ này'}
                          </small>
                        </button>
                      ))}
                      {!profiles.length && (
                        <EmptyState title="Bạn chưa có hồ sơ người khám" />
                      )}
                      <Link to="/patient/profiles/new">
                        + Thêm hồ sơ người khám
                      </Link>
                    </div>
                  )}
                </section>
                <aside className="state-card booking-step-panel">
                  <p className="eyebrow">LỊCH KHÁM ĐÃ CHỌN</p>
                  <h2>{service?.name ?? 'Chưa chọn dịch vụ'}</h2>
                  <dl className="detail-grid">
                    <div>
                      <dt>Bác sĩ</dt>
                      <dd>{doctor?.displayName ?? 'Chưa chọn'}</dd>
                    </div>
                    <div>
                      <dt>Thời gian</dt>
                      <dd>
                        {slot
                          ? date + ' · ' + time(slot.startAt)
                          : 'Khung giờ không còn khả dụng'}
                      </dd>
                    </div>
                    <div>
                      <dt>Người khám</dt>
                      <dd>{profile?.fullName ?? 'Chưa chọn hồ sơ'}</dd>
                    </div>
                  </dl>
                  {holdError != null && (
                    <ErrorPanel error={holdError} onRetry={continueBooking} />
                  )}
                  <button
                    className="button button-primary booking-next"
                    disabled={!slot || !profile || !service || holding}
                    onClick={() => void continueBooking()}
                  >
                    {holding ? 'Đang giữ chỗ…' : 'Giữ chỗ và tiếp tục →'}
                  </button>
                  <p className="field-hint">
                    Hạn giữ chỗ và số tiền được xác nhận ở bước thanh toán.
                  </p>
                </aside>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

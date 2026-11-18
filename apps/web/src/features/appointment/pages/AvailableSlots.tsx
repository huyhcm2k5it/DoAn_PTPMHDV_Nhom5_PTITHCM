import { BookingCalendar } from '../BookingCalendar';
import type { PatientApi, PatientProfile } from '../../patient/types';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type {
  CatalogApi,
  Department,
  Doctor,
  MedicalService,
} from '../../catalog/types';
import type { AppointmentApi, AvailableSlot } from '../types';
import { Loading } from '../../../shared/ui/Loading';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';

function localDateToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function timeInVietnam(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Ho_Chi_Minh',
      }).format(date)
    : 'Chưa rõ giờ';
}

export function AvailableSlots({
  api,
  catalog,
  patientApi,
  assistedPatient,
}: {
  api: AppointmentApi;
  patientApi?: PatientApi;
  assistedPatient?: PatientProfile;
  catalog: Pick<CatalogApi, 'departments' | 'doctors' | 'services'>;
}) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState(
    searchParams.get('departmentId') ?? '',
  );
  const [doctorId, setDoctorId] = useState(searchParams.get('doctorId') ?? '');
  const [serviceId, setServiceId] = useState(
    searchParams.get('serviceId') ?? '',
  );
  const [date, setDate] = useState(
    () => searchParams.get('date') ?? localDateToday(),
  );
  const [patientId, setPatientId] = useState(
    assistedPatient?.id ?? searchParams.get('patientId') ?? '',
  );
  const [profiles, setProfiles] = useState<PatientProfile[]>();
  const [profileError, setProfileError] = useState<unknown>();
  const holdIntent = useRef<{ signature: string; key: string } | null>(null);
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
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [services, setServices] = useState<MedicalService[]>([]);
  const [catalogState, setCatalogState] = useState<{
    loading: boolean;
    error?: unknown;
  }>({
    loading: true,
  });
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [slotState, setSlotState] = useState<{
    loading: boolean;
    items?: AvailableSlot[];
    error?: unknown;
  }>({ loading: false });
  const [slotRetry, setSlotRetry] = useState(0);
  const [holdError, setHoldError] = useState<unknown>();
  const [doctorQuery, setDoctorQuery] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot>();
  const [doctorPage, setDoctorPage] = useState(1);
  const [doctorTotal, setDoctorTotal] = useState(0);
  const [holdingSlot, setHoldingSlot] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setCatalogState({ loading: true });
    catalog.departments(controller.signal).then(
      (items) => {
        if (!current) return;
        setDepartments(items);
        setCatalogState({ loading: false });
      },
      (error) => {
        if (current && !controller.signal.aborted)
          setCatalogState({ loading: false, error });
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [catalog, catalogRetry]);

  useEffect(() => {
    const requestedDoctor = searchParams.get('doctorId');
    const requestedService = searchParams.get('serviceId');
    if (requestedDoctor) setDoctorId(requestedDoctor);
    if (requestedService) setServiceId(requestedService);
  }, [searchParams]);

  useEffect(() => {
    if (!departmentId) {
      setDoctors([]);
      setServices([]);
      return;
    }
    const controller = new AbortController();
    let current = true;
    setCatalogState({ loading: true });
    Promise.all([
      catalog.doctors(departmentId, doctorPage, controller.signal),
      catalog.services(departmentId, controller.signal),
    ]).then(
      ([doctorPage, serviceItems]) => {
        if (!current) return;
        setDoctors(doctorPage.items);
        setDoctorTotal(doctorPage.total);
        setServices(serviceItems);
        setCatalogState({ loading: false });
      },
      (error) => {
        if (current && !controller.signal.aborted)
          setCatalogState({ loading: false, error });
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [catalog, departmentId, catalogRetry, doctorPage]);

  useEffect(() => {
    if (!submitted || !doctorId || !serviceId || !date) return;
    const controller = new AbortController();
    let current = true;
    setSelectedSlot(undefined);
    setSlotState({ loading: true });
    api.listAvailable({ doctorId, serviceId, date }, controller.signal).then(
      (items) => {
        if (current) setSlotState({ loading: false, items });
      },
      (error) => {
        if (current && !controller.signal.aborted)
          setSlotState({ loading: false, error });
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [api, submitted, doctorId, serviceId, date, slotRetry]);

  function searchSlots(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setSlotRetry((value) => value + 1);
  }
  async function holdSlot(slot: AvailableSlot) {
    if (!patientId || holdingSlot) return;
    const signature = JSON.stringify([patientId, slot.slotId]);
    if (holdIntent.current?.signature !== signature)
      holdIntent.current = { signature, key: crypto.randomUUID() };
    setHoldError(undefined);
    setHoldingSlot(slot.slotId);
    try {
      const hold = await api.createHold(
        { patientId, slotId: slot.slotId },
        holdIntent.current.key,
      );
      holdIntent.current = null;
      navigate(
        `/patient/appointments/review?patientId=${encodeURIComponent(patientId)}&holdId=${encodeURIComponent(hold.holdId)}`,
        {
          state: {
            expiresAt: hold.expiresAt,
            amountVnd: hold.priceSnapshot?.amountVnd,
            startAt: slot.startAt,
            patientName:
              assistedPatient?.fullName ??
              profiles?.find((item) => item.id === patientId)?.fullName,
            doctorName: doctors.find((item) => item.id === doctorId)
              ?.displayName,
            serviceName: services.find((item) => item.id === serviceId)?.name,
            departmentName: departments.find((item) => item.id === departmentId)
              ?.name,
            returnTo: assistedPatient
              ? '/staff/reception?tab=r02'
              : '/patient/appointments/new?' +
                new URLSearchParams({
                  patientId,
                  departmentId,
                  doctorId,
                  serviceId,
                  date,
                }),
          },
        },
      );
    } catch (error) {
      setHoldError(error);
    } finally {
      setHoldingSlot(undefined);
    }
  }
  const currentService = services.find((item) => item.id === serviceId);
  return (
    <section className="page-content quan-workflow booking-design">
      <div className="page-heading">
        <div>
          <p className="eyebrow">CHĂM SÓC SỨC KHỎE</p>
          <h1 id="slots-heading">Đặt lịch khám</h1>
          <p>Chọn bác sĩ và khung giờ phù hợp với bạn.</p>
        </div>
      </div>
      <ol className="booking-progress">
        <li>1 Chuyên khoa</li>
        <li aria-current="step">2 Bác sĩ & giờ khám</li>
        <li>3 Thông tin khám</li>
        <li>4 Xác nhận</li>
      </ol>
      <div className="booking-layout">
        <div>
          <div className="state-card booking-filters">
            <label>
              <span className="sr-only">Chuyên khoa</span>
              <select
                value={departmentId}
                disabled={holdingSlot != null}
                onChange={(event) => {
                  setDepartmentId(event.target.value);
                  setDoctorId('');
                  setServiceId('');
                  setDoctorPage(1);
                  setSubmitted(false);
                  setSelectedSlot(undefined);
                  setSlotState({ loading: false });
                }}
              >
                <option value="">Chọn chuyên khoa</option>
                {departments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Tìm tên bác sĩ</span>
              <input
                placeholder="Tìm tên bác sĩ…"
                value={doctorQuery}
                onChange={(event) => setDoctorQuery(event.target.value)}
              />
            </label>
          </div>
          {catalogState.loading && (
            <Loading label="Đang tải bác sĩ và dịch vụ" />
          )}
          {catalogState.error != null && (
            <ErrorPanel
              error={catalogState.error}
              onRetry={() => setCatalogRetry((value) => value + 1)}
            />
          )}
          {!departmentId && (
            <EmptyState
              title="Chọn chuyên khoa"
              description="Danh sách bác sĩ và dịch vụ sẽ xuất hiện tại đây."
            />
          )}
          <div className="doctor-options">
            {doctors
              .filter((item) =>
                item.displayName
                  .toLocaleLowerCase('vi')
                  .includes(doctorQuery.toLocaleLowerCase('vi')),
              )
              .map((doctor) => (
                <article className="state-card doctor-option" key={doctor.id}>
                  <div className="doctor-initials" aria-hidden="true">
                    {doctor.displayName
                      .split(' ')
                      .slice(-2)
                      .map((word) => word[0])
                      .join('')}
                  </div>
                  <div>
                    <p className="field-hint">Bác sĩ</p>
                    <h2>{doctor.displayName}</h2>
                    <p>
                      {
                        departments.find(
                          (item) => item.id === doctor.departmentId,
                        )?.name
                      }
                    </p>
                    <button
                      className={
                        'button ' +
                        (doctorId === doctor.id
                          ? 'button-primary'
                          : 'button-secondary')
                      }
                      type="button"
                      aria-pressed={doctorId === doctor.id}
                      disabled={holdingSlot != null}
                      onClick={() => {
                        setDoctorId(doctor.id);
                        setSubmitted(false);
                        setSelectedSlot(undefined);
                        setSlotState({ loading: false });
                      }}
                    >
                      {doctorId === doctor.id ? 'Đã chọn' : 'Chọn bác sĩ'}
                    </button>
                  </div>
                </article>
              ))}
          </div>
          {doctorTotal > 20 && (
            <nav className="pagination" aria-label="Phân trang bác sĩ">
              <button
                disabled={doctorPage === 1}
                onClick={() => setDoctorPage((value) => value - 1)}
              >
                Trước
              </button>
              <span>Trang {doctorPage}</span>
              <button
                disabled={doctorPage * 20 >= doctorTotal}
                onClick={() => setDoctorPage((value) => value + 1)}
              >
                Sau
              </button>
            </nav>
          )}
        </div>
        <aside className="state-card booking-time">
          <h2>Chọn ngày & giờ</h2>
          <BookingCalendar
            value={date}
            disabled={holdingSlot != null}
            onChange={(value) => {
              setDate(value);
              setSubmitted(false);
              setSelectedSlot(undefined);
              setSlotState({ loading: false });
            }}
          />
          <form onSubmit={searchSlots}>
            <label>
              Dịch vụ khám
              <select
                required
                disabled={!departmentId || holdingSlot != null}
                value={serviceId}
                onChange={(event) => {
                  setServiceId(event.target.value);
                  setSubmitted(false);
                  setSelectedSlot(undefined);
                  setSlotState({ loading: false });
                }}
              >
                <option value="">Chọn dịch vụ</option>
                {services.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button-secondary"
              disabled={
                !doctorId ||
                !serviceId ||
                catalogState.loading ||
                holdingSlot != null
              }
            >
              Tìm lịch trống
            </button>
          </form>
          {slotState.loading && <Loading label="Đang tìm lịch trống" />}
          {slotState.error != null && (
            <ErrorPanel
              error={slotState.error}
              onRetry={() => setSlotRetry((value) => value + 1)}
            />
          )}
          {slotState.items?.length === 0 && (
            <EmptyState title="Không có khung giờ phù hợp" />
          )}
          <div className="booking-slot-grid">
            {!slotState.loading &&
              slotState.items?.map((slot) => (
                <button
                  key={slot.slotId}
                  type="button"
                  disabled={slot.remainingCapacity <= 0 || holdingSlot != null}
                  aria-pressed={selectedSlot?.slotId === slot.slotId}
                  onClick={() => setSelectedSlot(slot)}
                >
                  {timeInVietnam(slot.startAt)}
                </button>
              ))}
          </div>
          {patientApi && (
            <label>
              Hồ sơ người khám
              <select
                disabled={holdingSlot != null}
                value={patientId}
                onChange={(event) => setPatientId(event.target.value)}
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
          )}
          {assistedPatient && (
            <p>
              Người khám: <strong>{assistedPatient.fullName}</strong>
            </p>
          )}
          {profileError != null && <ErrorPanel error={profileError} />}
          {profiles?.length === 0 && (
            <Link to="/patient/profiles/new">Tạo hồ sơ người khám</Link>
          )}
          {!patientApi && !assistedPatient && (
            <Link to="/login">Đăng nhập để giữ chỗ</Link>
          )}
          {currentService?.price && (
            <p className="booking-price">
              {currentService.price.amountVnd.toLocaleString('vi-VN')} ₫
            </p>
          )}
          {holdError != null && <ErrorPanel error={holdError} />}
          <button
            type="button"
            className="button button-primary"
            disabled={
              !selectedSlot ||
              !patientId ||
              (!patientApi && !assistedPatient) ||
              holdingSlot != null
            }
            onClick={() => selectedSlot && void holdSlot(selectedSlot)}
          >
            {holdingSlot ? 'Đang giữ chỗ…' : 'Tiếp tục →'}
          </button>
        </aside>
      </div>
    </section>
  );
}

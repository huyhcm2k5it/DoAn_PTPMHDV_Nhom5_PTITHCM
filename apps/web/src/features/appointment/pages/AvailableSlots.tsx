import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type {
  CatalogApi,
  Department,
  Doctor,
  MedicalService,
} from '../../catalog/types';
import type { AppointmentApi, AvailableSlot } from '../types';
import type { PatientApi, PatientProfile } from '../../patient/types';
import { Loading } from '../../../shared/ui/Loading';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import '../appointment.css';

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
        hour12: false,
        timeZone: 'Asia/Ho_Chi_Minh',
      }).format(date)
    : value;
}

const MONTH_NAMES = [
  'Tháng 1',
  'Tháng 2',
  'Tháng 3',
  'Tháng 4',
  'Tháng 5',
  'Tháng 6',
  'Tháng 7',
  'Tháng 8',
  'Tháng 9',
  'Tháng 10',
  'Tháng 11',
  'Tháng 12',
];

const YEAR_OPTIONS = [2025, 2026, 2027, 2028, 2029, 2030];

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
  const [searchKeyword, setSearchKeyword] = useState('');
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
  }>({ loading: true });
  const [catalogRetry, setCatalogRetry] = useState(0);

  const [slotState, setSlotState] = useState<{
    key?: string;
    loading: boolean;
    items?: AvailableSlot[];
    error?: unknown;
  }>({ loading: false });
  const [slotRetry, setSlotRetry] = useState(0);
  const [holdError, setHoldError] = useState<unknown>();
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const [doctorPage, setDoctorPage] = useState(1);
  const [doctorTotal, setDoctorTotal] = useState(0);
  const [holdingSlot, setHoldingSlot] = useState<string>();

  // Lịch tương tác tháng / năm
  const [calendarYear, setCalendarYear] = useState(() => {
    const [y] = date.split('-').map(Number);
    return y || 2026;
  });
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const [, m] = date.split('-').map(Number);
    return m ? m - 1 : 10; // Mặc định tháng 11 (index 10)
  });

  // Đồng bộ calendar khi date thay đổi từ bên ngoài (URL params hoặc form)
  useEffect(() => {
    if (date) {
      const [y, m] = date.split('-').map(Number);
      if (y && m) {
        setCalendarYear(y);
        setCalendarMonth(m - 1);
      }
    }
  }, [date]);

  function handleMonthChange(newMonth: number) {
    setCalendarMonth(newMonth);
    const maxDays = new Date(calendarYear, newMonth + 1, 0).getDate();
    const currentDay = Number(date.split('-')[2]) || 1;
    const safeDay = Math.min(currentDay, maxDays);
    const formatted = `${calendarYear}-${String(newMonth + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
    setDate(formatted);
    setSlotRetry((r) => r + 1);
  }

  function handleYearChange(newYear: number) {
    setCalendarYear(newYear);
    const maxDays = new Date(newYear, calendarMonth + 1, 0).getDate();
    const currentDay = Number(date.split('-')[2]) || 1;
    const safeDay = Math.min(currentDay, maxDays);
    const formatted = `${newYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
    setDate(formatted);
    setSlotRetry((r) => r + 1);
  }

  function handleGoToToday() {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    const d = today.getDate();
    const formatted = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    setCalendarYear(y);
    setCalendarMonth(m);
    setDate(formatted);
    setSlotRetry((r) => r + 1);
  }

  function handlePrevMonth() {
    setCalendarMonth((prev) => {
      if (prev === 0) {
        setCalendarYear((y) => y - 1);
        return 11;
      }
      return prev - 1;
    });
  }

  function handleNextMonth() {
    setCalendarMonth((prev) => {
      if (prev === 11) {
        setCalendarYear((y) => y + 1);
        return 0;
      }
      return prev + 1;
    });
  }

  function handleSelectDay(dayNum: number) {
    const formatted = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    setDate(formatted);
    setSlotRetry((r) => r + 1);
  }

  const daysInMonth = useMemo(() => {
    return new Date(calendarYear, calendarMonth + 1, 0).getDate();
  }, [calendarYear, calendarMonth]);

  const firstDayCol = useMemo(() => {
    const day = new Date(calendarYear, calendarMonth, 1).getDay();
    // 0 = Chủ Nhật -> col 7; 1 = T2 -> col 1, ..., 6 = T7 -> col 6
    return day === 0 ? 7 : day;
  }, [calendarYear, calendarMonth]);

  const selectedDateLabel = useMemo(() => {
    if (!date) return 'Giờ khám';
    const [y, m, d] = date.split('-').map(Number);
    if (!y || !m || !d) return 'Giờ khám';
    const dateObj = new Date(y, m - 1, d);
    const dayNames = [
      'Chủ Nhật',
      'Thứ Hai',
      'Thứ Ba',
      'Thứ Tư',
      'Thứ Năm',
      'Thứ Sáu',
      'Thứ Bảy',
    ];
    const dayName = dayNames[dateObj.getDay()] || 'Thứ Hai';
    const dayStr = String(d).padStart(2, '0');
    const monthStr = String(m).padStart(2, '0');
    return `${dayName}, ${dayStr}/${monthStr}`;
  }, [date]);

  // Load danh sách chuyên khoa ban đầu
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
        if (current && !controller.signal.aborted) {
          setCatalogState({ loading: false, error });
        }
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

  // Load danh sách bác sĩ & dịch vụ theo chuyên khoa
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setCatalogState({ loading: true });
    Promise.all([
      catalog.doctors(departmentId, doctorPage, controller.signal),
      catalog.services(departmentId, controller.signal),
    ]).then(
      ([doctorPageData, serviceItems]) => {
        if (!current) return;
        setDoctors(
          doctorPageData.items.filter((item) => item.status === 'ACTIVE'),
        );
        setDoctorTotal(doctorPageData.total);
        setServices(serviceItems.filter((item) => item.status === 'ACTIVE'));
        setCatalogState({ loading: false });
      },
      (error) => {
        if (current && !controller.signal.aborted) {
          setCatalogState({ loading: false, error });
        }
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [catalog, departmentId, catalogRetry, doctorPage]);

  const canBook = Boolean(
    assistedPatient?.id === patientId ||
    profiles?.some((profile) => profile.id === patientId),
  );
  const filtersReady = Boolean(doctorId && serviceId && date);
  const slotKey = JSON.stringify([doctorId, serviceId, date, slotRetry]);
  const currentSlots =
    filtersReady && slotState.key === slotKey ? (slotState.items ?? []) : [];
  const selectedSlot = currentSlots.find(
    (slot) => slot.slotId === selectedSlotId,
  );
  const loadingSlots =
    filtersReady && (slotState.key !== slotKey || slotState.loading);
  const visibleDoctors = doctors.filter((doctor) =>
    doctor.displayName
      .toLocaleLowerCase('vi')
      .includes(searchKeyword.trim().toLocaleLowerCase('vi')),
  );
  const service = services.find((item) => item.id === serviceId);

  useEffect(() => {
    setSelectedSlotId('');
    setHoldError(undefined);
    if (!doctorId || !serviceId || !date) return;
    const controller = new AbortController();
    setSlotState({ key: slotKey, loading: true });
    api.listAvailable({ doctorId, serviceId, date }, controller.signal).then(
      (items) => {
        if (!controller.signal.aborted)
          setSlotState({ key: slotKey, loading: false, items });
      },
      (error) => {
        if (!controller.signal.aborted)
          setSlotState({ key: slotKey, loading: false, error });
      },
    );
    return () => controller.abort();
  }, [api, doctorId, serviceId, date, slotKey]);

  async function handleContinue() {
    if (!selectedSlot || !canBook || holdingSlot) return;
    const slot = selectedSlot;
    const signature = JSON.stringify([patientId, slot.slotId]);
    if (holdIntent.current?.signature !== signature) {
      holdIntent.current = { signature, key: crypto.randomUUID() };
    }
    setHoldError(undefined);
    setHoldingSlot(slot.slotId);
    try {
      const hold = await api.createHold(
        { patientId, slotId: slot.slotId },
        holdIntent.current.key,
      );
      holdIntent.current = null;
      const params = new URLSearchParams({ patientId, holdId: hold.holdId });
      navigate('/patient/appointments/review?' + params, {
        state: {
          holdId: hold.holdId,
          patientId,
          expiresAt: hold.expiresAt,
          amountVnd: hold.priceSnapshot?.amountVnd,
          startAt: slot.startAt,
          patientName:
            assistedPatient?.fullName ??
            profiles?.find((item) => item.id === patientId)?.fullName,
          doctorName: doctors.find((item) => item.id === slot.doctorId)
            ?.displayName,
          serviceName: service?.name,
          departmentName: departments.find(
            (item) => item.id === (service?.departmentId ?? departmentId),
          )?.name,
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
      });
    } catch (error) {
      setHoldError(error);
    } finally {
      setHoldingSlot(undefined);
    }
  }

  return (
    <div className="booking-page-container" aria-label="Đặt lịch khám">
      {/* Tiêu đề trang (Figma 1:3540) */}
      <div className="patient-header-banner">
        <span className="home-eyebrow">CHĂM SÓC SỨC KHỎE</span>
        <h1
          id="slots-heading"
          className="home-hero-title"
          style={{ fontSize: '26px' }}
        >
          Đặt lịch khám
        </h1>
        <p className="home-hero-desc">
          Chọn bác sĩ và khung giờ phù hợp với bạn.
        </p>
      </div>

      {/* 1. Thanh tiến trình 4 bước (Figma 1:3544) */}
      <nav className="booking-stepper" aria-label="Các bước đặt khám">
        <div className="stepper-step is-completed">
          <span className="step-number">✓</span>
          <span>1 Chuyên khoa</span>
        </div>
        <div className="stepper-divider" />
        <div className="stepper-step is-active">
          <span className="step-number">2</span>
          <span>2 Bác sĩ &amp; giờ khám</span>
        </div>
        <div className="stepper-divider" />
        <div className="stepper-step">
          <span className="step-number">3</span>
          <span>3 Xác nhận &amp; TT</span>
        </div>
        <div className="stepper-divider" />
        <div className="stepper-step">
          <span className="step-number">4</span>
          <span>4 Hoàn tất</span>
        </div>
      </nav>

      {/* 2. Bố cục 2 cột chính: Cột trái (Bác sĩ) + Cột phải (Lịch & Giờ) */}
      <div className="booking-layout-grid">
        {/* CỘT TRÁI (697px): Tìm kiếm & Danh sách thẻ bác sĩ (Figma 1:3552) */}
        <section
          className="booking-doctors-section booking-left-col"
          aria-label="Danh sách bác sĩ"
        >
          {/* Thanh tìm kiếm & lọc chuyên khoa (Figma 1:3554) */}
          <div className="doctor-filter-toolbar">
            <select
              className="doctor-filter-select"
              value={departmentId}
              aria-label="Chuyên khoa"
              disabled={holdingSlot != null}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                setDoctorPage(1);
                setDoctorId('');
                setServiceId('');
              }}
            >
              <option value="">Chuyên khoa: Tất cả ▾</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name}
                </option>
              ))}
            </select>

            <input
              type="search"
              className="doctor-search-input"
              placeholder="Tìm tên bác sĩ..."
              value={searchKeyword}
              aria-label="Tìm kiếm bác sĩ"
              onChange={(e) => setSearchKeyword(e.target.value)}
            />
          </div>

          <label className="booking-field">
            <span>Dịch vụ khám</span>
            <select
              className="doctor-filter-select"
              value={serviceId}
              disabled={holdingSlot != null}
              onChange={(event) => {
                const next = services.find(
                  (item) => item.id === event.target.value,
                );
                setServiceId(event.target.value);
                if (next && !departmentId) {
                  setDepartmentId(next.departmentId);
                  if (
                    doctors.find((item) => item.id === doctorId)
                      ?.departmentId !== next.departmentId
                  )
                    setDoctorId('');
                  setDoctorPage(1);
                }
              }}
            >
              <option value="">Chọn dịch vụ khám</option>
              {services.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {service?.price && (
            <p className="doctor-exam-fee">
              Phí khám niêm yết:{' '}
              {service.price.amountVnd.toLocaleString('vi-VN')} đ
            </p>
          )}

          {/* Trạng thái tải hoặc lỗi danh mục */}
          {catalogState.loading && <Loading label="Đang tải danh mục" />}
          {catalogState.error != null && (
            <ErrorPanel
              error={catalogState.error}
              onRetry={() => setCatalogRetry((v) => v + 1)}
            />
          )}

          {!catalogState.loading &&
            !catalogState.error &&
            visibleDoctors.length === 0 && (
              <EmptyState title="Không tìm thấy bác sĩ" />
            )}

          {/* Danh sách thẻ bác sĩ chuẩn Figma */}
          <div className="doctor-card-list">
            {visibleDoctors.map((doc) => {
              const isSelected = doc.id === doctorId;
              return (
                <article
                  key={doc.id}
                  className={`doctor-booking-card ${isSelected ? 'is-selected' : ''}`}
                >
                  <div className="doctor-card-left">
                    <div className="doctor-info-box">
                      <h3 className="doctor-full-name">{doc.displayName}</h3>
                      <p className="doctor-specialty-rating">
                        {departments.find(
                          (item) => item.id === doc.departmentId,
                        )?.name ?? 'Chuyên khoa'}
                      </p>
                    </div>
                  </div>

                  <div className="doctor-card-right">
                    <button
                      type="button"
                      className={`doctor-select-btn ${isSelected ? 'is-active' : 'is-inactive'}`}
                      disabled={holdingSlot != null}
                      onClick={() => {
                        setDoctorId(doc.id);
                        if (!departmentId) {
                          setDepartmentId(doc.departmentId);
                          setDoctorPage(1);
                          if (service?.departmentId !== doc.departmentId)
                            setServiceId('');
                        }
                      }}
                    >
                      {isSelected ? 'Đã chọn' : 'Chọn bác sĩ'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {doctorTotal > 20 && (
            <nav
              className="booking-pagination"
              aria-label="Trang danh sách bác sĩ"
            >
              <button
                type="button"
                disabled={doctorPage <= 1 || holdingSlot != null}
                onClick={() => setDoctorPage(doctorPage - 1)}
              >
                Trang trước
              </button>
              <span>
                {doctorPage} / {Math.ceil(doctorTotal / 20)}
              </span>
              <button
                type="button"
                disabled={doctorPage * 20 >= doctorTotal || holdingSlot != null}
                onClick={() => setDoctorPage(doctorPage + 1)}
              >
                Trang sau
              </button>
            </nav>
          )}
        </section>

        {/* CỘT PHẢI (419px): Chọn ngày & giờ khám (Figma 1:3586) */}
        <aside
          className="booking-datetime-panel"
          aria-label="Chọn ngày và giờ khám"
        >
          <h2 className="panel-section-title">Chọn ngày &amp; giờ</h2>

          {/* Chọn hồ sơ nếu có patientApi */}
          {patientApi && (
            <div style={{ marginBottom: '16px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: 'var(--text-secondary, #475569)',
                  marginBottom: '4px',
                }}
              >
                Hồ sơ người khám
              </label>
              <select
                className="doctor-filter-select"
                style={{ width: '100%' }}
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
            </div>
          )}
          {assistedPatient && (
            <p style={{ fontSize: '13px', marginBottom: '12px' }}>
              Người khám: <strong>{assistedPatient.fullName}</strong>
            </p>
          )}
          {profileError != null && <ErrorPanel error={profileError} />}
          {profiles?.length === 0 && (
            <p style={{ fontSize: '13px', marginBottom: '12px' }}>
              <Link to="/patient/profiles/new">Tạo hồ sơ người khám</Link>
            </p>
          )}

          <fieldset
            className="booking-calendar"
            disabled={holdingSlot != null}
            aria-label="Chọn ngày khám"
          >
            {/* Lịch tháng (Figma 1:3588 kết hợp Quick Selector Tháng / Năm / Hôm nay hiện đại) */}
            <div className="calendar-month-nav">
              <div className="calendar-quick-pickers">
                <select
                  className="calendar-select-month"
                  value={calendarMonth}
                  aria-label="Chọn tháng trực tiếp"
                  onChange={(e) => handleMonthChange(Number(e.target.value))}
                >
                  {MONTH_NAMES.map((name, idx) => (
                    <option key={idx} value={idx}>
                      {name}
                    </option>
                  ))}
                </select>

                <select
                  className="calendar-select-year"
                  value={calendarYear}
                  aria-label="Chọn năm trực tiếp"
                  onChange={(e) => handleYearChange(Number(e.target.value))}
                >
                  {YEAR_OPTIONS.map((yr) => (
                    <option key={yr} value={yr}>
                      Năm {yr}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  className="calendar-today-btn"
                  title="Nhảy nhanh về ngày hôm nay"
                  onClick={handleGoToToday}
                >
                  Hôm nay
                </button>
              </div>

              <div className="calendar-nav-arrows">
                <button
                  type="button"
                  className="calendar-nav-btn"
                  aria-label="Tháng trước"
                  onClick={handlePrevMonth}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="calendar-nav-btn"
                  aria-label="Tháng sau"
                  onClick={handleNextMonth}
                >
                  ›
                </button>
              </div>
            </div>

            {/* Tiêu đề thứ trong tuần (Figma 1:3589 - 1:3595) */}
            <div className="calendar-weekdays-grid">
              <span>T2</span>
              <span>T3</span>
              <span>T4</span>
              <span>T5</span>
              <span>T6</span>
              <span>T7</span>
              <span>CN</span>
            </div>

            {/* Lưới các ngày trong tháng (Figma 1:3596 - 1:3642) */}
            <div
              className="calendar-days-grid"
              role="grid"
              aria-label="Các ngày trong tháng"
            >
              {Array.from({ length: daysInMonth }, (_, index) => {
                const dayNum = index + 1;
                const formatted = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                const isSelected = date === formatted;
                const isToday = formatted === localDateToday();
                const cellStyle =
                  dayNum === 1 ? { gridColumnStart: firstDayCol } : undefined;

                return (
                  <button
                    key={dayNum}
                    type="button"
                    style={cellStyle}
                    className={`calendar-day-cell ${isSelected ? 'is-selected' : ''} ${isToday && !isSelected ? 'is-today' : ''}`}
                    aria-label={`Ngày ${dayNum} tháng ${calendarMonth + 1}${isToday ? ' (Hôm nay)' : ''}`}
                    aria-pressed={isSelected ? 'true' : 'false'}
                    onClick={() => handleSelectDay(dayNum)}
                  >
                    {dayNum}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <h3 className="timeslot-section-title">{selectedDateLabel}</h3>
          {!filtersReady && (
            <p>Chọn bác sĩ, dịch vụ và ngày khám để xem giờ trống.</p>
          )}
          {loadingSlots && <Loading label="Đang tải khung giờ" />}
          {!loadingSlots && filtersReady && slotState.error != null && (
            <ErrorPanel
              error={slotState.error}
              onRetry={() => setSlotRetry((value) => value + 1)}
            />
          )}
          {!loadingSlots &&
            filtersReady &&
            slotState.error == null &&
            currentSlots.length === 0 && (
              <EmptyState
                title="Không có khung giờ phù hợp"
                description="Hãy đổi ngày hoặc chọn bác sĩ, dịch vụ khác."
              />
            )}
          <div
            className="timeslot-grid"
            role="group"
            aria-label="Danh sách khung giờ"
          >
            {currentSlots.map((slot) => (
              <button
                key={slot.slotId}
                type="button"
                disabled={holdingSlot != null}
                className={`timeslot-chip ${selectedSlotId === slot.slotId ? 'is-selected' : 'is-available'}`}
                onClick={() => setSelectedSlotId(slot.slotId)}
                aria-pressed={selectedSlotId === slot.slotId}
              >
                {timeInVietnam(slot.startAt)}
              </button>
            ))}
          </div>
          {holdError != null && (
            <ErrorPanel error={holdError} onRetry={handleContinue} />
          )}

          {/* Nút Tiếp tục (Figma 1:3639) */}
          <button
            type="button"
            className="btn-booking-continue"
            disabled={!selectedSlot || !canBook || holdingSlot != null}
            onClick={handleContinue}
          >
            {holdingSlot ? 'Đang giữ chỗ…' : 'Tiếp tục  →'}
          </button>
        </aside>
      </div>
    </div>
  );
}

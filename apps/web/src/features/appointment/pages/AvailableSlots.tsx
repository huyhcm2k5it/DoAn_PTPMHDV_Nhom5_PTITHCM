import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { CatalogApi, Department, Doctor, MedicalService } from '../../catalog/types';
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
}: {
  api: AppointmentApi;
  catalog: Pick<CatalogApi, 'departments' | 'doctors' | 'services'>;
}) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [doctorId, setDoctorId] = useState(searchParams.get('doctorId') ?? '');
  const [serviceId, setServiceId] = useState(searchParams.get('serviceId') ?? '');
  const [date, setDate] = useState(localDateToday);
  const [patientId, setPatientId] = useState(searchParams.get('patientId') ?? '');
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [services, setServices] = useState<MedicalService[]>([]);
  const [catalogState, setCatalogState] = useState<{ loading: boolean; error?: unknown }>({
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
        if (current && !controller.signal.aborted) setCatalogState({ loading: false, error });
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
      catalog.doctors(departmentId, 1, controller.signal),
      catalog.services(departmentId, controller.signal),
    ]).then(
      ([doctorPage, serviceItems]) => {
        if (!current) return;
        setDoctors(doctorPage.items);
        setServices(serviceItems);
        setCatalogState({ loading: false });
      },
      (error) => {
        if (current && !controller.signal.aborted) setCatalogState({ loading: false, error });
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [catalog, departmentId]);

  useEffect(() => {
    if (!submitted) return;
    const controller = new AbortController();
    let current = true;
    setSlotState({ loading: true });
    api.listAvailable({ doctorId, serviceId, date }, controller.signal).then(
      (items) => {
        if (current) setSlotState({ loading: false, items });
      },
      (error) => {
        if (current && !controller.signal.aborted) setSlotState({ loading: false, error });
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
    setHoldError(undefined);
    setHoldingSlot(slot.slotId);
    try {
      const hold = await api.createHold({ patientId, slotId: slot.slotId }, crypto.randomUUID());
      navigate(
        `/patient/appointments/review?patientId=${encodeURIComponent(patientId)}&holdId=${encodeURIComponent(hold.holdId)}`,
      );
    } catch (error) {
      setHoldError(error);
    } finally {
      setHoldingSlot(undefined);
    }
  }
  return (
    <section className="page-content" aria-labelledby="slots-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">ĐẶT LỊCH KHÁM</p>
          <h1 id="slots-heading">Tra cứu lịch trống</h1>
          <p>Chọn bác sĩ, dịch vụ và ngày khám để xem khung giờ còn chỗ.</p>
        </div>
        <span className="status-pill">Chưa giữ chỗ</span>
      </div>
      {catalogState.loading && departments.length === 0 ? (
        <Loading label="Đang tải danh mục" />
      ) : catalogState.error ? (
        <ErrorPanel
          error={catalogState.error}
          onRetry={() => setCatalogRetry((value) => value + 1)}
        />
      ) : (
        <form className="search-panel" onSubmit={searchSlots}>
          <label>
            Mã hồ sơ bệnh nhân
            <input
              value={patientId}
              onChange={(event) => setPatientId(event.target.value)}
              placeholder="Nhập khi muốn giữ chỗ"
            />
          </label>
          <label>
            Chuyên khoa
            <select
              required
              value={departmentId}
              onChange={(event) => {
                setDepartmentId(event.target.value);
                setDoctorId('');
                setServiceId('');
                setSubmitted(false);
                setSlotState({ loading: false });
              }}
            >
              <option value="">Chọn chuyên khoa</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bác sĩ
            <select
              required
              value={doctorId}
              onChange={(event) => {
                setDoctorId(event.target.value);
                setSubmitted(false);
                setSlotState({ loading: false });
              }}
              disabled={!departmentId || catalogState.loading}
            >
              <option value="">Chọn bác sĩ</option>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Dịch vụ khám
            <select
              required
              value={serviceId}
              onChange={(event) => {
                setServiceId(event.target.value);
                setSubmitted(false);
                setSlotState({ loading: false });
              }}
              disabled={!departmentId || catalogState.loading}
            >
              <option value="">Chọn dịch vụ</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ngày khám
            <input
              required
              type="date"
              value={date}
              min={localDateToday()}
              onChange={(event) => {
                setDate(event.target.value);
                setSubmitted(false);
                setSlotState({ loading: false });
              }}
            />
          </label>
          {catalogState.loading && departmentId && (
            <p className="field-hint" role="status">
              Đang tải bác sĩ và dịch vụ…
            </p>
          )}
          {catalogState.error != null && (
            <ErrorPanel
              error={catalogState.error}
              onRetry={() => setCatalogRetry((value) => value + 1)}
            />
          )}
          <button
            className="button button-primary"
            type="submit"
            disabled={!departmentId || catalogState.loading}
          >
            Tìm lịch trống
          </button>
        </form>
      )}
      {slotState.loading && <Loading label="Đang tìm lịch trống" />}
      {!slotState.loading && slotState.error != null && (
        <ErrorPanel
          error={slotState.error}
          onRetry={() => {
            setSubmitted(true);
            setSlotRetry((value) => value + 1);
          }}
        />
      )}
      {!slotState.loading && slotState.items?.length === 0 && (
        <EmptyState
          title="Không có khung giờ phù hợp"
          description="Hãy đổi ngày hoặc chọn bác sĩ, dịch vụ khác."
        />
      )}
      {holdError != null && <ErrorPanel error={holdError} />}
      {!slotState.loading && (slotState.items?.length ?? 0) > 0 && (
        <section className="slot-results" aria-label="Khung giờ còn trống">
          <div className="section-heading">
            <h2>Khung giờ còn chỗ</h2>
            <span>{slotState.items?.length} khung giờ</span>
          </div>
          <div className="slot-grid">
            {slotState.items?.map((slot) => (
              <article className="slot-card" key={slot.slotId}>
                <div>
                  <strong>{timeInVietnam(slot.startAt)}</strong>
                  <span>– {timeInVietnam(slot.endAt)}</span>
                </div>
                <p>Còn {slot.remainingCapacity} chỗ</p>
                <button
                  className="button button-primary"
                  type="button"
                  disabled={!patientId || holdingSlot != null}
                  onClick={() => holdSlot(slot)}
                >
                  {holdingSlot === slot.slotId ? 'Đang giữ…' : 'Giữ khung giờ'}
                </button>
              </article>
            ))}
          </div>
          <p className="field-hint">
            Giữ chỗ có thời hạn 10 phút. Lịch chỉ được tạo sau bước xác nhận.
          </p>
        </section>
      )}
    </section>
  );
}

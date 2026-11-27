import { useEffect, useRef, useState } from 'react';
import type { AppointmentApi, ScheduleInput, ScheduleResult } from '../types';
import type {
  CatalogApi,
  Department,
  Doctor,
  MedicalService,
} from '../../catalog/types';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import { Loading } from '../../../shared/ui/Loading';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { formatAppointmentTime } from '../display';

type Schedule = ScheduleResult['schedule'];
const initial: ScheduleInput = {
  doctorId: '',
  serviceId: '',
  room: '',
  startAt: '',
  endAt: '',
  capacityPerSlot: 1,
  slotMinutes: 30,
};
const local = (v: string) => {
  if (!v) return '';
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export function ScheduleAdmin({
  api,
  catalog,
}: {
  api: AppointmentApi;
  catalog: CatalogApi;
}) {
  const [form, setForm] = useState<ScheduleInput>(initial);
  const [selected, setSelected] = useState<Schedule>();
  const [schedules, setSchedules] = useState<Schedule[]>();
  const [listError, setListError] = useState<unknown>();
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const intent = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  const [departments, setDepartments] = useState<Department[]>();
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [services, setServices] = useState<MedicalService[]>([]);
  const [catalogError, setCatalogError] = useState<unknown>();
  const [departmentId, setDepartmentId] = useState('');
  const [filter, setFilter] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setSchedules(undefined);
    setListError(undefined);
    if (!api.listSchedules) {
      setListError(new Error('Chưa có adapter danh sách ca.'));
      return;
    }
    api.listSchedules({}, c.signal).then(
      (x) => {
        if (!c.signal.aborted) setSchedules(x.items);
      },
      (e) => {
        if (!c.signal.aborted) setListError(e);
      },
    );
    return () => c.abort();
  }, [api, revision]);
  useEffect(() => {
    const c = new AbortController();
    setCatalogError(undefined);
    setDepartments(undefined);
    async function load() {
      const [ds, ss] = await Promise.all([
        catalog.departments(c.signal),
        catalog.services('', c.signal),
      ]);
      let dd: Doctor[] = [];
      for (let page = 1; ; page++) {
        const result = await catalog.doctors('', page, c.signal);
        dd.push(...result.items);
        if (!result.items.length || page * 20 >= result.total) break;
      }
      return { ds, ss, dd };
    }
    load().then(
      ({ ds, ss, dd }) => {
        if (!c.signal.aborted) {
          setDepartments(ds);
          setServices(ss);
          setDoctors(dd);
        }
      },
      (e) => {
        if (!c.signal.aborted) setCatalogError(e);
      },
    );
    return () => c.abort();
  }, [catalog, revision]);
  function set<K extends keyof ScheduleInput>(key: K, value: ScheduleInput[K]) {
    setForm((x) => ({ ...x, [key]: value }));
    setNotice('');
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    setError(undefined);
    setNotice('');
    if (Date.parse(form.endAt) <= Date.parse(form.startAt)) {
      setError(new Error('Giờ kết thúc phải sau giờ bắt đầu.'));
      return;
    }
    if (!selected && Date.parse(form.startAt) <= Date.now()) {
      setError(new Error('Chọn một ca khám trong tương lai.'));
      return;
    }
    lock.current = true;
    setBusy(true);
    const input = selected
      ? {
          room: form.room,
          startAt: form.startAt,
          endAt: form.endAt,
          capacityPerSlot: form.capacityPerSlot,
          expectedVersion: selected.version,
        }
      : form;
    const signature = JSON.stringify([selected?.id, input]);
    if (intent.current?.signature !== signature)
      intent.current = { signature, key: crypto.randomUUID() };
    try {
      if (selected) {
        if (!api.updateSchedule) throw new Error('Chưa có adapter sửa ca.');
        const updated = await api.updateSchedule(
          selected.id,
          input as Partial<ScheduleInput> & { expectedVersion: number },
          intent.current.key,
        );
        setSelected(updated);
        setForm(updated);
        setNotice('Đã cập nhật ca khám theo phiên bản mới.');
      } else {
        if (!api.createSchedule) throw new Error('Chưa có adapter tạo ca.');
        await api.createSchedule(form, intent.current.key);
        setForm(initial);
        setNotice('Đã tạo ca khám và sinh khung giờ.');
      }
      intent.current = undefined;
      setRevision((x) => x + 1);
    } catch (e) {
      setError(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const name = (id: string) =>
    doctors.find((x) => x.id === id)?.displayName ??
    'Bác sĩ #' + id.slice(0, 8);
  return (
    <section className="page-content quan-workflow schedule-design">
      <header className="page-heading">
        <div>
          <p className="eyebrow">QUẢN TRỊ LỊCH KHÁM</p>
          <h1>Phân công ca trực</h1>
          <p>Quản lý bác sĩ, phòng khám và sức chứa từng khung giờ.</p>
        </div>
        <button
          className="button button-secondary"
          onClick={() => setRevision((x) => x + 1)}
        >
          Làm mới
        </button>
      </header>
      <div className="schedule-columns">
        <section className="state-card">
          <div className="page-heading">
            <h2>Danh sách ca khám</h2>
            <label>
              Lọc theo ngày
              <input
                type="date"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
          </div>
          {listError != null ? (
            <ErrorPanel
              error={listError}
              onRetry={() => setRevision((x) => x + 1)}
            />
          ) : !schedules ? (
            <Loading label="Đang tải ca khám" />
          ) : (
            <>
              <p className="field-hint">
                {
                  schedules.filter(
                    (x) => !filter || local(x.startAt).startsWith(filter),
                  ).length
                }{' '}
                ca trong danh sách đã tải
              </p>
              <div className="pharmacy-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Bác sĩ / dịch vụ</th>
                      <th>Thời gian</th>
                      <th>Phòng / sức chứa</th>
                      <th>Trạng thái</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {schedules
                      .filter(
                        (x) => !filter || local(x.startAt).startsWith(filter),
                      )
                      .map((x) => (
                        <tr key={x.id}>
                          <th>
                            {name(x.doctorId)}
                            <small>
                              {services.find((v) => v.id === x.serviceId)
                                ?.name ?? x.serviceId.slice(0, 8)}
                            </small>
                          </th>
                          <td>
                            {formatAppointmentTime(x.startAt)}
                            <small>Đến {formatAppointmentTime(x.endAt)}</small>
                          </td>
                          <td>
                            {x.room ?? '—'}
                            <small>
                              {x.capacityPerSlot} người / {x.slotMinutes} phút
                            </small>
                          </td>
                          <td>
                            <span className="status-pill">
                              {Date.parse(x.endAt) <= Date.now()
                                ? 'Ca đã qua'
                                : x.status === 'CLOSED'
                                  ? 'Đã đóng'
                                  : 'Đang mở'}
                            </span>
                          </td>
                          <td>
                            <button
                              className="button button-secondary"
                              disabled={
                                busy || Date.parse(x.startAt) <= Date.now()
                              }
                              onClick={() => {
                                setSelected(x);
                                setForm(x);
                                setDepartmentId(
                                  doctors.find((d) => d.id === x.doctorId)
                                    ?.departmentId ?? '',
                                );
                                setError(undefined);
                                setNotice('');
                              }}
                            >
                              Sửa
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {!schedules.length && <EmptyState title="Chưa có ca khám" />}
            </>
          )}
        </section>
        <aside className="state-card">
          <h2>{selected ? 'Sửa ca khám' : 'Tạo ca khám'}</h2>
          <p className="field-hint">
            {selected
              ? 'Phiên bản ' + selected.version
              : 'Chọn thông tin từ danh mục đang hoạt động.'}
          </p>
          {catalogError != null && (
            <ErrorPanel
              error={catalogError}
              onRetry={() => setRevision((x) => x + 1)}
            />
          )}
          <form className="schedule-form" onSubmit={(e) => void submit(e)}>
            <fieldset disabled={busy || !departments}>
              <label>
                Chuyên khoa
                <select
                  disabled={!!selected}
                  value={departmentId}
                  onChange={(e) => {
                    setDepartmentId(e.target.value);
                    set('doctorId', '');
                    set('serviceId', '');
                  }}
                >
                  <option value="">Tất cả chuyên khoa</option>
                  {departments
                    ?.filter((x) => x.status === 'ACTIVE')
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Bác sĩ
                <select
                  required
                  disabled={!!selected}
                  value={form.doctorId}
                  onChange={(e) => set('doctorId', e.target.value)}
                >
                  <option value="">Chọn bác sĩ</option>
                  {doctors
                    .filter(
                      (x) =>
                        (x.status === 'ACTIVE' || x.id === form.doctorId) &&
                        (!departmentId || x.departmentId === departmentId),
                    )
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.displayName}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Dịch vụ
                <select
                  required
                  disabled={!!selected}
                  value={form.serviceId}
                  onChange={(e) => set('serviceId', e.target.value)}
                >
                  <option value="">Chọn dịch vụ khám</option>
                  {services
                    .filter(
                      (x) =>
                        (x.status === 'ACTIVE' || x.id === form.serviceId) &&
                        (!departmentId || x.departmentId === departmentId),
                    )
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Phòng khám
                <input
                  required
                  value={form.room ?? ''}
                  onChange={(e) => set('room', e.target.value)}
                  placeholder="Ví dụ: P.101"
                />
              </label>
              {(['startAt', 'endAt'] as const).map((key, i) => (
                <label key={key}>
                  {i ? 'Kết thúc' : 'Bắt đầu'}
                  <input
                    required
                    type="datetime-local"
                    value={local(form[key])}
                    onChange={(e) =>
                      set(
                        key,
                        e.target.value
                          ? new Date(e.target.value).toISOString()
                          : '',
                      )
                    }
                  />
                </label>
              ))}
              <div className="form-two-columns">
                <label>
                  Sức chứa / slot
                  <input
                    required
                    type="number"
                    min={1}
                    value={form.capacityPerSlot}
                    onChange={(e) =>
                      set('capacityPerSlot', Number(e.target.value))
                    }
                  />
                </label>
                <label>
                  Phút / slot
                  <input
                    required
                    disabled={!!selected}
                    type="number"
                    min={5}
                    value={form.slotMinutes}
                    onChange={(e) => set('slotMinutes', Number(e.target.value))}
                  />
                </label>
              </div>
              <button className="button button-primary" type="submit">
                {busy ? 'Đang lưu…' : selected ? 'Lưu thay đổi' : 'Tạo ca khám'}
              </button>
              {selected && (
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => {
                    setSelected(undefined);
                    setForm(initial);
                    setError(undefined);
                  }}
                >
                  Hủy sửa
                </button>
              )}
            </fieldset>
          </form>
          {error != null && <ErrorPanel error={error} />}{' '}
          {notice && (
            <p role="status" className="success-message">
              {notice}
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}

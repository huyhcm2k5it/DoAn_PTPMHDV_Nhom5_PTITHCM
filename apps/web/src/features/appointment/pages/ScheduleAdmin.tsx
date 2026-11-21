import { useEffect, useRef, useState } from 'react';
import type { AppointmentApi, ScheduleInput } from '../types';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';

const initial: ScheduleInput = {
  doctorId: '',
  serviceId: '',
  room: '',
  startAt: '',
  endAt: '',
  capacityPerSlot: 1,
  slotMinutes: 30,
  status: 'OPEN',
};

function localDateTime(value: string) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function ScheduleAdmin({ api }: { api: AppointmentApi }) {
  const [form, setForm] = useState<ScheduleInput>(initial);
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState<unknown>();
  const [saving, setSaving] = useState(false);
  const intent = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  const [schedules, setSchedules] = useState<
    Array<ScheduleInput & { id: string; version: number }>
  >([]);
  const [selected, setSelected] = useState<{ id: string; version: number }>();
  useEffect(() => {
    const controller = new AbortController();
    api.listSchedules?.({}, controller.signal).then(
      (data) => setSchedules(data.items),
      () => undefined,
    );
    return () => controller.abort();
  }, [api, result]);
  function set<K extends keyof ScheduleInput>(key: K, value: ScheduleInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(undefined);
    setResult(undefined);
    try {
      const patch = selected && {
        room: form.room,
        startAt: form.startAt,
        endAt: form.endAt,
        capacityPerSlot: form.capacityPerSlot,
        expectedVersion: selected.version,
      };
      const signature = JSON.stringify([selected?.id, patch || form]);
      if (intent.current?.signature !== signature)
        intent.current = { signature, key: crypto.randomUUID() };
      const key = intent.current.key;
      if (selected && patch) {
        const updated = await api.updateSchedule?.(selected.id, patch, key);
        if (updated) {
          setSelected({ id: updated.id, version: updated.version });
          setResult(updated);
        }
      } else if (!selected) {
        setResult(await api.createSchedule?.(form, key));
      }
      intent.current = undefined;
    } catch (caught) {
      setError(caught);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="page-content" aria-labelledby="schedule-heading">
      <p className="eyebrow">QUẢN TRỊ LỊCH KHÁM</p>
      <h1 id="schedule-heading">{selected ? 'Sửa ca khám' : 'Tạo ca khám'}</h1>
      {error != null && <ErrorPanel error={error} />}
      {result != null && (
        <p role="status">
          {selected
            ? 'Đã cập nhật ca và khung giờ.'
            : 'Đã tạo ca và sinh các slot.'}
        </p>
      )}
      <form className="search-panel" onSubmit={(event) => void submit(event)}>
        <label>
          Bác sĩ
          <input
            required
            disabled={selected != null}
            value={form.doctorId}
            onChange={(event) => set('doctorId', event.target.value)}
          />
        </label>
        <label>
          Dịch vụ
          <input
            required
            disabled={selected != null}
            value={form.serviceId}
            onChange={(event) => set('serviceId', event.target.value)}
          />
        </label>
        <label>
          Phòng
          <input
            required
            value={form.room ?? ''}
            onChange={(event) => set('room', event.target.value)}
          />
        </label>
        <label>
          Bắt đầu
          <input
            required
            type="datetime-local"
            value={localDateTime(form.startAt)}
            onChange={(event) =>
              set(
                'startAt',
                event.target.value
                  ? new Date(event.target.value).toISOString()
                  : '',
              )
            }
          />
        </label>
        <label>
          Kết thúc
          <input
            required
            type="datetime-local"
            value={localDateTime(form.endAt)}
            onChange={(event) =>
              set(
                'endAt',
                event.target.value
                  ? new Date(event.target.value).toISOString()
                  : '',
              )
            }
          />
        </label>
        <label>
          Sức chứa/slot
          <input
            required
            type="number"
            min={1}
            value={form.capacityPerSlot}
            onChange={(event) =>
              set('capacityPerSlot', Number(event.target.value))
            }
          />
        </label>
        <label>
          Phút/slot
          <input
            required
            type="number"
            min={5}
            disabled={selected != null}
            value={form.slotMinutes}
            onChange={(event) => set('slotMinutes', Number(event.target.value))}
          />
        </label>
        <button
          className="button button-primary"
          disabled={saving}
          type="submit"
        >
          {saving ? 'Đang lưu…' : selected ? 'Cập nhật ca' : 'Tạo ca khám'}
        </button>
        {selected && (
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              setSelected(undefined);
              setForm(initial);
            }}
          >
            Hủy sửa
          </button>
        )}
      </form>
      <h2>Ca đã tạo</h2>
      <ul>
        {schedules.map((schedule) => (
          <li key={schedule.id}>
            <span>
              {schedule.id.slice(0, 8)} · {schedule.startAt} · {schedule.status}
            </span>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                setSelected({ id: schedule.id, version: schedule.version });
                setForm(schedule);
              }}
            >
              Sửa
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

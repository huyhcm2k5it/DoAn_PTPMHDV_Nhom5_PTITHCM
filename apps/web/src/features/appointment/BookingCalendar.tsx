import { useState } from 'react';

export function BookingCalendar({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [month, setMonth] = useState(() => new Date(value + 'T12:00:00'));
  const year = month.getFullYear();
  const index = month.getMonth();
  const offset = (new Date(year, index, 1).getDay() + 6) % 7;
  const count = new Date(year, index + 1, 0).getDate();
  return (
    <div className="booking-calendar">
      <label className="calendar-date-input">
        Ngày khám
        <input
          type="date"
          value={value}
          disabled={disabled}
          onChange={(event) => {
            if (!event.target.value) return;
            onChange(event.target.value);
            setMonth(new Date(event.target.value + 'T12:00:00'));
          }}
        />
      </label>
      <div className="calendar-heading">
        <strong>
          Tháng {index + 1}, {year}
        </strong>
        <button
          type="button"
          disabled={disabled}
          aria-label="Tháng trước"
          onClick={() => setMonth(new Date(year, index - 1, 1))}
        >
          ‹
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label="Tháng sau"
          onClick={() => setMonth(new Date(year, index + 1, 1))}
        >
          ›
        </button>
      </div>
      <div className="calendar-grid">
        {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((day) => (
          <span key={day}>{day}</span>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={'blank' + i} />
        ))}
        {Array.from({ length: count }, (_, i) => {
          const day = String(i + 1).padStart(2, '0');
          const date =
            year + '-' + String(index + 1).padStart(2, '0') + '-' + day;
          return (
            <button
              type="button"
              key={date}
              aria-label={date}
              aria-pressed={value === date}
              disabled={disabled}
              onClick={() => onChange(date)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

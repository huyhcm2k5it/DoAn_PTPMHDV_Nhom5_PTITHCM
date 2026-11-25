import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GatewayTransport } from '../../../app/runtime';
import type { CatalogApi, MedicalService } from '../../catalog/types';
import type { AdminSummary as Summary, AppointmentApi } from '../types';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import { Loading } from '../../../shared/ui/Loading';
import { appointmentLabels, formatAppointmentTime } from '../display';

type Revenue = { receivedVnd: number; refundedVnd: number; asOf: string };
const money = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
});
const dayInVietnam = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const shortDate = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'UTC',
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
});

function addDays(day: string, count: number) {
  const date = new Date(day + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function AdminSummary({
  api,
  catalog,
  transport,
}: {
  api: AppointmentApi;
  catalog: CatalogApi;
  transport: GatewayTransport;
}) {
  const [date, setDate] = useState(() => dayInVietnam.format(new Date()));
  const [revision, setRevision] = useState(0);
  const [week, setWeek] = useState<Array<{ day: string; data: Summary }>>();
  const [revenue, setRevenue] = useState<Revenue>();
  const [prices, setPrices] = useState<MedicalService[]>();
  const [errors, setErrors] = useState<Record<string, unknown>>({});
  useEffect(() => {
    if (!date) return;
    const controller = new AbortController();
    const { signal } = controller;
    setWeek(undefined);
    setRevenue(undefined);
    setPrices(undefined);
    setErrors({});
    const record = (key: string) => (error: unknown) => {
      if (!signal.aborted)
        setErrors((current) => ({ ...current, [key]: error }));
    };
    const mondayOffset = (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7;
    const days = Array.from({ length: 7 }, (_, i) =>
      addDays(date, i - mondayOffset),
    );
    if (api.getAdminSummary) {
      Promise.all(
        days.map(async (day) => ({
          day,
          data: await api.getAdminSummary!(day, signal),
        })),
      ).then((result) => {
        if (!signal.aborted) setWeek(result);
      }, record('appointments'));
    }
    const period = new URLSearchParams({ from: date, to: addDays(date, 1) });
    transport('/api/v1/admin/reports/summary?' + period, { signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw Object.assign(
            new Error(body.error?.message ?? 'Không tải được báo cáo thu phí.'),
            { status: response.status, code: body.error?.code },
          );
        if (!signal.aborted) setRevenue(body.data);
      })
      .catch(record('revenue'));
    catalog.services('', signal).then((result) => {
      if (!signal.aborted) setPrices(result);
    }, record('catalog'));
    return () => controller.abort();
  }, [api, catalog, transport, date, revision]);

  const day = week?.find((row) => row.day === date)?.data;
  const maximum = Math.max(
    1,
    ...(week ?? []).map((row) => row.data.appointments.metrics?.completed ?? 0),
  );
  const retry = () => setRevision((value) => value + 1);
  return (
    <section
      className="page-content quan-workflow"
      aria-labelledby="summary-heading"
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow">KHÔNG GIAN LÀM VIỆC</p>
          <h1 id="summary-heading">Tổng quan bệnh viện</h1>
          <p>Theo dõi hoạt động ngoại trú và viện phí theo ngày.</p>
        </div>
        <label>
          Ngày báo cáo{' '}
          <input
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
      </div>
      {!date && <p>Chọn ngày để tải số liệu.</p>}
      {errors.appointments != null && (
        <ErrorPanel error={errors.appointments} onRetry={retry} />
      )}
      {date && !week && !errors.appointments && (
        <Loading label="Đang tải tổng hợp lịch khám" />
      )}
      {errors.revenue != null && (
        <ErrorPanel error={errors.revenue} onRetry={retry} />
      )}
      <div className="card-grid quan-overview-kpis">
        <article className="state-card">
          <span>Lượt khám hoàn tất</span>
          <strong>{day?.appointments.metrics?.completed ?? '—'}</strong>
        </article>
        <article className="state-card">
          <span>Doanh thu viện phí</span>
          <strong>{revenue ? money.format(revenue.receivedVnd) : '—'}</strong>
          {revenue && (
            <small>Đã hoàn {money.format(revenue.refundedVnd)}</small>
          )}
        </article>
        <article className="state-card">
          <span>Công suất phòng khám</span>
          <strong>—</strong>
          <small>Chưa có nguồn số liệu</small>
        </article>
        <article className="state-card">
          <span>Chờ cận lâm sàng</span>
          <strong>—</strong>
          <small>Chưa có nguồn số liệu</small>
        </article>
      </div>
      {revenue && (
        <p className="field-hint">
          Báo cáo viện phí cập nhật {formatAppointmentTime(revenue.asOf)}.
        </p>
      )}
      {week && (
        <div className="quan-overview-panes">
          <section className="state-card">
            <h2>Lượt khám trong tuần</h2>
            <ul
              className="quan-week-bars"
              aria-label="Lượt khám hoàn tất từng ngày"
            >
              {week.map((row) => {
                const count = row.data.appointments.metrics?.completed ?? 0;
                return (
                  <li key={row.day}>
                    <strong>{count}</strong>
                    <meter
                      min={0}
                      max={maximum}
                      value={count}
                      aria-label={shortDate.format(
                        new Date(row.day + 'T00:00:00Z'),
                      )}
                    />
                    <span>
                      {shortDate.format(new Date(row.day + 'T00:00:00Z'))}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="state-card">
            <h2>Lịch hẹn theo trạng thái</h2>
            <dl className="detail-grid">
              <div>
                <dt>Lịch hẹn</dt>
                <dd>{day?.appointments.total ?? '—'}</dd>
              </div>
              <div>
                <dt>Vé trong ngày</dt>
                <dd>{day?.queue.total ?? '—'}</dd>
              </div>
              {Object.entries(day?.appointments.byState ?? {}).map(
                ([state, count]) => (
                  <div key={state}>
                    <dt>{appointmentLabels[state] ?? state}</dt>
                    <dd>{count}</dd>
                  </div>
                ),
              )}
            </dl>
          </section>
        </div>
      )}
      <section className="state-card">
        <div className="page-heading">
          <h2>Bảng giá dịch vụ</h2>
          <div className="quan-actions">
            <Link to="/catalog">Mở danh mục và phiên bản giá</Link>
            <Link to="/staff/schedules">Phân công ca trực</Link>
          </div>
        </div>
        {errors.catalog != null && (
          <ErrorPanel error={errors.catalog} onRetry={retry} />
        )}
        {prices && (
          <div className="pharmacy-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Mã dịch vụ</th>
                  <th>Tên dịch vụ</th>
                  <th>Giá niêm yết</th>
                  <th>Hiệu lực từ</th>
                </tr>
              </thead>
              <tbody>
                {prices.map((service) => (
                  <tr key={service.id}>
                    <td>{service.code}</td>
                    <td>{service.name}</td>
                    <td>
                      {service.price
                        ? money.format(service.price.amountVnd)
                        : 'Chưa niêm yết'}
                    </td>
                    <td>
                      {service.price
                        ? formatAppointmentTime(service.price.effectiveFrom)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}

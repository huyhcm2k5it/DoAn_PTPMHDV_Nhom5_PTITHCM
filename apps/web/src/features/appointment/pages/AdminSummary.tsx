import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GatewayTransport } from '../../../app/runtime';
import type { CatalogApi, MedicalService } from '../../catalog/types';
import type { AdminSummary as Summary, AppointmentApi } from '../types';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import { Loading } from '../../../shared/ui/Loading';
import { formatAppointmentTime } from '../display';

type Revenue = { receivedVnd: number; refundedVnd: number; asOf: string };
const dayVN = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(
    new Date(),
  );
const addDays = (day: string, n: number) =>
  new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000)
    .toISOString()
    .slice(0, 10);
const money = (n: number) => n.toLocaleString('vi-VN') + ' ₫';
export function AdminSummary({
  api,
  catalog,
  transport,
}: {
  api: AppointmentApi;
  catalog: CatalogApi;
  transport: GatewayTransport;
}) {
  const [date, setDate] = useState(dayVN);
  const [revision, setRevision] = useState(0);
  const [week, setWeek] = useState<Array<{ day: string; data: Summary }>>();
  const [revenue, setRevenue] = useState<Revenue>();
  const [prices, setPrices] = useState<MedicalService[]>();
  const [errors, setErrors] = useState<Record<string, unknown>>({});
  useEffect(() => {
    if (!date) return;
    const c = new AbortController();
    const { signal } = c;
    setWeek(undefined);
    setRevenue(undefined);
    setPrices(undefined);
    setErrors({});
    const fail = (key: string) => (error: unknown) => {
      if (!signal.aborted) setErrors((x) => ({ ...x, [key]: error }));
    };
    const offset = (new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7;
    if (api.getAdminSummary)
      Promise.all(
        Array.from({ length: 7 }, async (_, i) => {
          const day = addDays(date, i - offset);
          const data = await api.getAdminSummary!(day, signal);
          if (!Number.isFinite(data.booked) || !Number.isFinite(data.completed))
            throw new Error(
              'Phản hồi tổng quan lịch khám không đúng hợp đồng.',
            );
          return { day, data };
        }),
      ).then((x) => {
        if (!signal.aborted) setWeek(x);
      }, fail('appointments'));
    transport(
      '/api/v1/admin/reports/summary?' +
        new URLSearchParams({ from: date, to: addDays(date, 1) }),
      { signal },
    )
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok)
          throw new Error(b.error?.message ?? 'Không tải được viện phí.');
        if (!signal.aborted) setRevenue(b.data);
      })
      .catch(fail('revenue'));
    catalog.services('', signal).then((x) => {
      if (!signal.aborted) setPrices(x);
    }, fail('catalog'));
    return () => c.abort();
  }, [api, catalog, transport, date, revision]);
  const selected = week?.find((x) => x.day === date)?.data;
  const max = Math.max(1, ...(week ?? []).map((x) => x.data.completed));
  const retry = () => setRevision((x) => x + 1);
  return (
    <section className="page-content quan-workflow">
      <header className="page-heading">
        <div>
          <p className="eyebrow">QUẢN TRỊ HỆ THỐNG</p>
          <h1>Tổng quan bệnh viện</h1>
          <p>Hoạt động khám và viện phí theo ngày Việt Nam.</p>
        </div>
        <label>
          Ngày báo cáo
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </header>
      <nav className="quan-record-tabs" aria-label="Quản trị">
        <span aria-current="page">Tổng quan</span>
        <Link to="/staff/schedules">Phân công ca trực</Link>
        <Link to="/staff/prices">Phiên bản giá</Link>
      </nav>
      {errors.appointments != null ? (
        <ErrorPanel error={errors.appointments} onRetry={retry} />
      ) : date && !week ? (
        <Loading label="Đang tải tổng quan lịch khám" />
      ) : null}
      {errors.revenue != null && (
        <ErrorPanel error={errors.revenue} onRetry={retry} />
      )}
      <div className="overview-cards">
        {[
          ['Lịch được đặt', selected?.booked],
          ['Đã check-in', selected?.checkedIn],
          ['Khám hoàn tất', selected?.completed],
          ['Lịch đã hủy', selected?.cancelled],
        ].map(([label, value]) => (
          <article className="state-card" key={label}>
            <span>{label}</span>
            <strong>{value ?? '—'}</strong>
            <small>Nguồn: Appointment · AP-019</small>
          </article>
        ))}
      </div>
      <div className="overview-panels">
        <section className="state-card">
          <h2>Lượt khám hoàn tất trong tuần</h2>
          <div className="overview-chart">
            {week?.map((x) => (
              <div key={x.day}>
                <strong>{x.data.completed}</strong>
                <meter min={0} max={max} value={x.data.completed} />
                <span>
                  {new Intl.DateTimeFormat('vi-VN', {
                    day: '2-digit',
                    month: '2-digit',
                  }).format(new Date(x.day + 'T12:00:00Z'))}
                </span>
              </div>
            ))}
          </div>
          {selected && (
            <p className="field-hint">
              Dữ liệu cập nhật {formatAppointmentTime(selected.asOf)}
            </p>
          )}
        </section>
        <section className="state-card">
          <h2>Viện phí trong ngày</h2>
          <dl className="detail-grid">
            <div>
              <dt>Đã thu</dt>
              <dd>{revenue ? money(revenue.receivedVnd) : '—'}</dd>
            </div>
            <div>
              <dt>Đã hoàn</dt>
              <dd>{revenue ? money(revenue.refundedVnd) : '—'}</dd>
            </div>
          </dl>
          <p className="field-hint">
            Nguồn: Billing · BI-010
            {revenue ? ' · ' + formatAppointmentTime(revenue.asOf) : ''}
          </p>
          <p className="field-hint">
            Công suất phòng khám và số ca chờ LAB chưa có nguồn tổng hợp.
          </p>
        </section>
      </div>
      <section className="state-card">
        <div className="page-heading">
          <div>
            <h2>Bảng giá dịch vụ</h2>
            <p>Giá tham khảo hiện có trong Catalog.</p>
          </div>
          <Link to="/staff/prices">Xem phiên bản giá →</Link>
        </div>
        {errors.catalog != null ? (
          <ErrorPanel error={errors.catalog} onRetry={retry} />
        ) : !prices ? (
          <Loading label="Đang tải danh mục" />
        ) : (
          <div className="pharmacy-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Dịch vụ</th>
                  <th>Mã</th>
                  <th>Giá hiện tại</th>
                </tr>
              </thead>
              <tbody>
                {prices.map((x) => (
                  <tr key={x.id}>
                    <th>{x.name}</th>
                    <td>{x.code}</td>
                    <td>
                      {x.price
                        ? money(x.price.amountVnd)
                        : 'Chưa có giá hiệu lực'}
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

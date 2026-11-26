import { useEffect, useRef, useState } from 'react';
import { FlaskConical, RefreshCw, Search } from 'lucide-react';
import { DiagnosticError, diagnosticMessage } from './api';
import type {
  DiagnosticApi,
  DiagnosticOrder,
  DiagnosticSession,
  OrderDetail,
  Specimen,
} from './types';
import type { PatientSummary } from '../clinical/types';
import {
  ConfirmDialog,
  Empty,
  Loading,
  Notice,
  shortId,
  timeLabel,
} from '../clinical/ClinicalUI';
import { useMutation } from '../clinical/useMutation';
import { ResultEditor } from './ResultEditor';
import './diagnostic.css';

export const orderLabels: Record<string, string> = {
  PENDING_PAYMENT: 'Chờ thanh toán',
  SETTLEMENT_LOCKED: 'Đang xác minh thanh toán',
  PAID: 'Chờ lấy mẫu',
  SPECIMEN_COLLECTED: 'Đã lấy mẫu',
  SPECIMEN_REJECTED: 'Cần lấy lại mẫu',
  PUBLISHED: 'Đã công bố',
  CANCELLED: 'Đã hủy',
};
export function DiagnosticFeature({
  api,
  session,
  patients,
}: {
  api: DiagnosticApi;
  session?: DiagnosticSession;
  patients?: Record<string, PatientSummary>;
}) {
  if (
    !session ||
    session.actorType !== 'STAFF' ||
    !session.capabilities.some((cap) =>
      ['LAB_TECH', 'LAB_REVIEW'].includes(cap),
    )
  )
    return (
      <section className="diagnostic-feature huy-workspace">
        <header className="huy-page-heading">
          <div>
            <p className="huy-eyebrow">KHÔNG GIAN LÀM VIỆC</p>
            <h1>Không gian xét nghiệm</h1>
          </div>
        </header>
        <div className="huy-paper">
          <Notice tone="warning">
            Đăng nhập bằng tài khoản nhân viên được cấp quyền xét nghiệm để tiếp
            tục.
          </Notice>
        </div>
      </section>
    );
  return (
    <Queue
      key={session.userId + ':' + session.capabilities.slice().sort().join(',')}
      api={api}
      session={session}
      patients={patients}
    />
  );
}

function Queue({
  api,
  session,
  patients,
}: {
  api: DiagnosticApi;
  session: DiagnosticSession;
  patients?: Record<string, PatientSummary>;
}) {
  const [pending, setPending] = useState(false);
  const [state, setState] = useState(''),
    [page, setPage] = useState(1),
    [reload, setReload] = useState(0),
    [selected, setSelected] = useState(''),
    [query, setQuery] = useState('');
  const [list, setList] = useState<{ items: DiagnosticOrder[]; total: number }>(
    { items: [], total: 0 },
  );
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<unknown>(),
    [dirty, setDirty] = useState(false),
    [next, setNext] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    setLoading(true);
    setError(undefined);
    api
      .list({ state, page, limit: 20 }, abort.signal)
      .then((result) => {
        if (active) {
          setList(result);
          setSelected((current) => current || result.items[0]?.id || '');
        }
      })
      .catch((e) => {
        if (active) setError(e);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [api, state, page, reload]);
  const filtered = list.items.filter((order) =>
    (
      order.id +
      ' ' +
      order.patientId +
      ' ' +
      (patients?.[order.patientId]?.fullName ?? '')
    )
      .toLocaleLowerCase('vi-VN')
      .includes(query.toLocaleLowerCase('vi-VN')),
  );
  const open = (id: string) => {
    if (id !== selected && dirty) setNext(id);
    else setSelected(id);
  };
  return (
    <section className="diagnostic-feature huy-workspace">
      <header className="huy-page-heading">
        <div>
          <p className="huy-eyebrow">KHÔNG GIAN LÀM VIỆC</p>
          <h1>Không gian xét nghiệm</h1>
          <p>Quản lý mẫu bệnh phẩm và công bố kết quả.</p>
        </div>
        <span className="huy-badge info">
          <FlaskConical size={16} aria-hidden="true" />
          {session.capabilities.includes('LAB_REVIEW')
            ? 'Duyệt & công bố'
            : 'Nhập kết quả'}
        </span>
      </header>
      <div className="huy-paper huy-lab-toolbar">
        <label>
          Trạng thái xét nghiệm
          <select
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Tất cả trạng thái</option>
            {Object.entries(orderLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p>
          Thanh toán <span>·</span> Lấy mẫu <span>·</span> Nhập kết quả{' '}
          <span>·</span> Duyệt
        </p>
        <button
          className="huy-button secondary"
          type="button"
          onClick={() => setReload((n) => n + 1)}
        >
          <RefreshCw size={16} aria-hidden="true" />
          Làm mới
        </button>
      </div>
      <div className="huy-diagnostic-grid">
        <aside className="huy-paper huy-queue">
          <div className="huy-section-title">
            <h2>Mẫu bệnh phẩm</h2>
            <span className="huy-count">{list.total}</span>
          </div>
          <label>
            <span className="huy-sr-only">Tìm trong trang xét nghiệm</span>
            <div className="huy-search-field">
              <Search size={18} aria-hidden="true" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tìm mã chỉ định / hồ sơ trong trang…"
              />
            </div>
          </label>
          {loading ? (
            <Loading />
          ) : error ? (
            <Notice tone="error">{diagnosticMessage(error)}</Notice>
          ) : !filtered.length ? (
            <Empty>Chưa có chỉ định xét nghiệm phù hợp.</Empty>
          ) : (
            <ul className="huy-queue-list">
              {filtered.map((order) => (
                <li key={order.id}>
                  <button
                    type="button"
                    aria-pressed={order.id === selected}
                    disabled={pending}
                    aria-label={'Mở order ' + order.id}
                    className={order.id === selected ? 'selected' : ''}
                    onClick={() => open(order.id)}
                  >
                    <span>
                      <small className="huy-order-code">
                        XN-{shortId(order.id)}
                      </small>
                      <strong>
                        {patients?.[order.patientId]?.fullName ||
                          'Hồ sơ ' + shortId(order.patientId)}
                      </strong>
                      <small>
                        {order.tests
                          .map((test) => test.name || test.code)
                          .join(', ')}
                      </small>
                      <span
                        className={
                          'huy-badge ' +
                          (order.state === 'PUBLISHED'
                            ? 'success'
                            : order.state === 'CANCELLED'
                              ? 'neutral'
                              : 'info')
                        }
                      >
                        {orderLabels[order.state] ?? order.state}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <nav className="huy-pagination" aria-label="Phân trang xét nghiệm">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((n) => n - 1)}
            >
              Trước
            </button>
            <span>Trang {page}</span>
            <button
              type="button"
              disabled={page * 20 >= list.total || loading}
              onClick={() => setPage((n) => n + 1)}
            >
              Sau
            </button>
          </nav>
        </aside>
        {selected ? (
          <Order
            key={selected}
            api={api}
            id={selected}
            session={session}
            patient={
              patients?.[
                list.items.find((o) => o.id === selected)?.patientId ?? ''
              ]
            }
            onDirty={setDirty}
            onPending={setPending}
            onChanged={() => setReload((n) => n + 1)}
          />
        ) : (
          <section className="huy-paper">
            <Empty>Chọn một chỉ định để xem mẫu và kết quả.</Empty>
          </section>
        )}
      </div>
      {next && (
        <ConfirmDialog
          title="Chuyển chỉ định xét nghiệm?"
          onClose={() => setNext('')}
          onConfirm={() => {
            setDirty(false);
            setSelected(next);
            setNext('');
          }}
        >
          <p>
            Kết quả đang nhập chưa được lưu sẽ bị bỏ. Chọn quay lại để lưu nháp
            trước.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

function Order({
  api,
  id,
  session,
  patient,
  onDirty,
  onChanged,
  onPending,
}: {
  api: DiagnosticApi;
  id: string;
  session: DiagnosticSession;
  patient?: PatientSummary;
  onDirty: (dirty: boolean) => void;
  onChanged: () => void;
  onPending: (pending: boolean) => void;
}) {
  const [detail, setDetail] = useState<OrderDetail>(),
    [loading, setLoading] = useState(true),
    [reload, setReload] = useState(0),
    [error, setError] = useState<unknown>();
  const [barcode, setBarcode] = useState(''),
    [reason, setReason] = useState(''),
    [rejecting, setRejecting] = useState<Specimen | null>(null);
  const mutation = useMutation();
  const [resultDirty, setResultDirty] = useState(false);
  const [resultPending, setResultPending] = useState(false);
  const latest = useRef({ locked: false, dirty: false });
  latest.current = {
    locked: mutation.locked || resultPending,
    dirty: resultDirty,
  };
  useEffect(() => {
    onPending(mutation.busy || mutation.uncertain || resultPending);
  }, [mutation.busy, mutation.uncertain, resultPending, onPending]);
  useEffect(() => () => onPending(false), [onPending]);
  useEffect(() => {
    onDirty(resultDirty || mutation.uncertain);
  }, [resultDirty, mutation.uncertain, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    async function load(quiet = false) {
      if (quiet && (latest.current.locked || latest.current.dirty)) return;
      if (!quiet) setLoading(true);
      try {
        const value = await api.detail(id, abort.signal);
        if (active) {
          setDetail(value);
          setError(undefined);
        }
      } catch (e) {
        if (active) {
          setError(e);
          if (
            e instanceof DiagnosticError &&
            [401, 403, 404].includes(e.status)
          ) {
            setDetail(undefined);
            active = false;
            setLoading(false);
          }
        }
      } finally {
        if (active && !quiet) setLoading(false);
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      await load(true);
      if (active) timer = setTimeout(poll, 5000);
    }
    void load().then(() => {
      if (active) timer = setTimeout(poll, 5000);
    });
    return () => {
      active = false;
      abort.abort();
      if (timer) clearTimeout(timer);
    };
  }, [api, id, reload]);
  if (loading && !detail)
    return (
      <section className="huy-paper">
        <Loading>Đang tải chỉ định…</Loading>
      </section>
    );
  if (!detail)
    return (
      <section className="huy-paper">
        <Notice tone="error">
          {diagnosticMessage(error)}
          <button type="button" onClick={() => setReload((n) => n + 1)}>
            Tải lại chỉ định
          </button>
        </Notice>
      </section>
    );
  const order = detail.order;
  const canCollect = session.capabilities.includes('LAB_TECH');
  const paid = order.chargeState === 'PAID';
  const collected = detail.specimens.at(-1);
  const result = detail.results
    ?.slice()
    .sort((a, b) => b.revision - a.revision)[0];
  const update = () => {
    setReload((n) => n + 1);
    onChanged();
  };
  function sample(recollect = false) {
    const input = barcode.trim() ? { barcode: barcode.trim() } : {};
    mutation.perform(
      (key) =>
        recollect ? api.recollect(id, input, key) : api.collect(id, input, key),
      () => {
        setBarcode('');
        update();
      },
      recollect
        ? 'Đã lấy lại mẫu trên cùng chỉ định.'
        : 'Đã ghi nhận mẫu bệnh phẩm.',
    );
  }
  return (
    <section
      className="huy-paper huy-diagnostic-detail"
      aria-label="Chi tiết xét nghiệm"
    >
      <header className="huy-section-title">
        <div>
          <h2>
            {order.tests.map((test) => test.name || test.code).join(', ') ||
              'Chỉ định xét nghiệm'}{' '}
            · #{shortId(id)}
          </h2>
          <p className="huy-muted">
            {patient?.fullName || 'Hồ sơ ' + shortId(order.patientId)}
            {patient?.birthDate
              ? ' · ' + new Date(patient.birthDate).toLocaleDateString('vi-VN')
              : ''}
          </p>
        </div>
        <span
          className={
            'huy-badge ' + (order.state === 'PUBLISHED' ? 'success' : 'warning')
          }
        >
          {orderLabels[order.state] ?? order.state}
        </span>
      </header>
      {error !== undefined && (
        <Notice tone="error">
          {diagnosticMessage(error)} Trạng thái đang hiển thị là lần xác nhận
          gần nhất.
        </Notice>
      )}
      {mutation.notice && <Notice tone="success">{mutation.notice}</Notice>}
      {mutation.error !== undefined && (
        <Notice tone="error">
          {diagnosticMessage(mutation.error)}
          {mutation.uncertain && (
            <button
              type="button"
              disabled={mutation.busy}
              onClick={() => void mutation.retry()}
            >
              Thử lại thao tác mẫu
            </button>
          )}
          {mutation.conflict && (
            <button
              type="button"
              onClick={() => {
                mutation.resolveConflict();
                update();
              }}
            >
              Tải lại trạng thái mẫu
            </button>
          )}
        </Notice>
      )}
      {!paid && order.state !== 'CANCELLED' && (
        <div className="huy-await-payment">
          <FlaskConical size={42} strokeWidth={1.5} aria-hidden="true" />
          <h3>Đang chờ xác nhận thanh toán</h3>
          <p>Thông tin lấy mẫu sẽ sẵn sàng sau khi viện phí xác nhận.</p>
          <button
            className="huy-button secondary"
            type="button"
            onClick={update}
          >
            <RefreshCw size={16} aria-hidden="true" />
            Kiểm tra thanh toán
          </button>
        </div>
      )}
      {order.state === 'CANCELLED' && (
        <Notice tone="warning">
          Chỉ định đã hủy. Không tiếp tục lấy mẫu hoặc nhập kết quả.
          {order.refundStatus && (
            <p>
              Hoàn tiền:{' '}
              {(
                {
                  NOT_REQUIRED: 'Chưa thu tiền · Không phát sinh hoàn tiền',
                  PENDING_SYNC: 'Đang chờ viện phí xác nhận',
                  REQUESTED: 'Đã yêu cầu',
                  FAILED: 'Thất bại — cần viện phí kiểm tra',
                  SUCCEEDED: 'Đã hoàn tiền',
                } as Record<string, string>
              )[order.refundStatus] ?? order.refundStatus}
              .
            </p>
          )}
        </Notice>
      )}
      {canCollect &&
        paid &&
        ['PAID', 'SPECIMEN_REJECTED'].includes(order.state) && (
          <section className="huy-sample-form">
            <h3>
              {order.state === 'SPECIMEN_REJECTED'
                ? 'Lấy lại mẫu bệnh phẩm'
                : 'Lấy mẫu bệnh phẩm'}
            </h3>
            <label>
              Mã mẫu
              <input
                value={barcode}
                maxLength={120}
                disabled={mutation.locked}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Để trống để hệ thống cấp barcode"
              />
            </label>
            <button
              className="huy-button"
              type="button"
              disabled={mutation.locked || !!error}
              onClick={() => sample(order.state === 'SPECIMEN_REJECTED')}
            >
              {mutation.busy
                ? 'Đang ghi nhận…'
                : order.state === 'SPECIMEN_REJECTED'
                  ? 'Lấy lại mẫu'
                  : 'Xác nhận lấy mẫu'}
            </button>
          </section>
        )}
      {!!detail.specimens.length && (
        <details className="huy-specimen-history">
          <summary>Lịch sử mẫu bệnh phẩm ({detail.specimens.length})</summary>
          {detail.specimens.map((specimen) => (
            <div className="huy-specimen" key={specimen.id}>
              <div>
                <strong>{specimen.barcode}</strong>
                <p>
                  Lần {specimen.sequence} ·{' '}
                  {specimen.state === 'REJECTED' ? 'Đã từ chối' : 'Đã lấy mẫu'}{' '}
                  · {timeLabel(specimen.collectedAt)}
                </p>
                {specimen.reasonCode && <p>Lý do {specimen.reasonCode}</p>}
              </div>
              {canCollect &&
                specimen.id === collected?.id &&
                specimen.state === 'COLLECTED' &&
                !result &&
                order.state === 'SPECIMEN_COLLECTED' && (
                  <button
                    type="button"
                    className="huy-link danger"
                    disabled={mutation.locked || !!error}
                    onClick={() => setRejecting(specimen)}
                  >
                    Từ chối mẫu
                  </button>
                )}
            </div>
          ))}
        </details>
      )}
      {(order.state === 'SPECIMEN_COLLECTED' ||
        order.state === 'PUBLISHED') && (
        <ResultEditor
          key={id}
          api={api}
          order={order}
          result={result}
          session={session}
          onChanged={update}
          onDirty={setResultDirty}
          onPending={setResultPending}
          unavailable={!!error || mutation.locked}
        />
      )}
      {rejecting && (
        <ConfirmDialog
          title="Từ chối mẫu bệnh phẩm?"
          confirmLabel="Từ chối mẫu"
          confirmDisabled={!reason.trim()}
          onClose={() => setRejecting(null)}
          onConfirm={() => {
            const specimen = rejecting;
            const input = {
              reasonCode: reason.trim(),
              expectedVersion: specimen.version,
            };
            setRejecting(null);
            mutation.perform(
              (key) => api.reject(specimen.id, input, key),
              () => {
                setReason('');
                update();
              },
              'Đã từ chối mẫu. Có thể lấy lại mẫu trên cùng chỉ định.',
            );
          }}
        >
          <label>
            Lý do từ chối mẫu
            <textarea
              required
              value={reason}
              maxLength={128}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Nhập lý do mẫu không đạt"
            />
          </label>
        </ConfirmDialog>
      )}
    </section>
  );
}

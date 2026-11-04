import React, { useEffect, useRef, useState } from 'react';
import { DiagnosticError, diagnosticMessage } from './api';
import type {
  DiagnosticApi,
  DiagnosticOrder,
  DiagnosticSession,
  OrderDetail,
  Specimen,
} from './types';
import './diagnostic.css';
const states: Record<string, string> = {
  PENDING_PAYMENT: 'Chờ thanh toán',
  SETTLEMENT_LOCKED: 'Đang xác minh thanh toán',
  PAID: 'Đã thanh toán',
  SPECIMEN_COLLECTED: 'Đã lấy mẫu',
  SPECIMEN_REJECTED: 'Cần lấy lại mẫu',
};
export function DiagnosticFeature({
  api,
  session,
}: {
  api: DiagnosticApi;
  session?: DiagnosticSession;
}) {
  if (
    !session ||
    session.actorType !== 'STAFF' ||
    !session.capabilities.some((c) => c === 'LAB_TECH' || c === 'LAB_REVIEW')
  )
    return (
      <section className="diagnostic-feature">
        <h1>Phòng xét nghiệm</h1>
        <p role="alert">Màn hình này dành cho nhân viên LAB có quyền.</p>
      </section>
    );
  return (
    <Queue
      key={session.userId + ':' + session.capabilities.slice().sort().join(',')}
      api={api}
      canCollect={session.capabilities.includes('LAB_TECH')}
    />
  );
}
function Queue({ api, canCollect }: { api: DiagnosticApi; canCollect: boolean }) {
  const [state, setState] = useState(''),
    [page, setPage] = useState(1),
    [reload, setReload] = useState(0),
    [selected, setSelected] = useState('');
  const [list, setList] = useState<{ items: DiagnosticOrder[]; total: number }>({
      items: [],
      total: 0,
    }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<unknown>();
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    setLoading(true);
    setError(undefined);
    api
      .list({ state, page, limit: 20 }, abort.signal)
      .then((result) => {
        if (active) setList(result);
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
  return (
    <section className="diagnostic-feature">
      <header>
        <div>
          <p>Không gian nhân viên LAB</p>
          <h1>Phòng xét nghiệm</h1>
        </div>
        <button onClick={() => setReload((n) => n + 1)}>Làm mới hàng chờ</button>
      </header>
      <label>
        Trạng thái order
        <select
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Tất cả</option>
          {Object.entries(states).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="diagnostic-columns">
        <section aria-label="Hàng chờ xét nghiệm">
          <h2>Order xét nghiệm ({list.total})</h2>
          {loading ? (
            <p role="status">Đang tải hàng chờ…</p>
          ) : error ? (
            <p role="alert">{diagnosticMessage(error)}</p>
          ) : list.items.length === 0 ? (
            <p>Chưa có order phù hợp.</p>
          ) : (
            <ul>
              {list.items.map((o) => (
                <li key={o.id}>
                  <strong>{o.id.slice(0, 8)}</strong>
                  <span>{states[o.state] ?? o.state}</span>
                  <span>Phí: {o.chargeState}</span>
                  <button onClick={() => setSelected(o.id)}>Mở order {o.id.slice(0, 8)}</button>
                </li>
              ))}
            </ul>
          )}
          <nav aria-label="Phân trang LAB">
            <button disabled={page <= 1 || loading} onClick={() => setPage((n) => n - 1)}>
              Trang trước
            </button>
            <span>Trang {page}</span>
            <button
              disabled={page * 20 >= list.total || loading}
              onClick={() => setPage((n) => n + 1)}
            >
              Trang sau
            </button>
          </nav>
        </section>
        {selected ? (
          <Order
            key={selected}
            api={api}
            id={selected}
            canCollect={canCollect}
            onChanged={() => setReload((n) => n + 1)}
          />
        ) : (
          <p>Chọn một order để xem phí và mẫu.</p>
        )}
      </div>
    </section>
  );
}
function Order({
  api,
  id,
  canCollect,
  onChanged,
}: {
  api: DiagnosticApi;
  id: string;
  canCollect: boolean;
  onChanged: () => void;
}) {
  const apiRef = useRef(api);
  apiRef.current = api;
  const [detail, setDetail] = useState<OrderDetail | null>(null),
    [loading, setLoading] = useState(true),
    [reload, setReload] = useState(0),
    [error, setError] = useState<unknown>(),
    [mutationError, setMutationError] = useState<unknown>();
  const [barcode, setBarcode] = useState(''),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [notice, setNotice] = useState('');
  const alive = useRef(true),
    attempt = useRef<{ key: string; run: (key: string) => Promise<{ specimen: Specimen }> } | null>(
      null,
    );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    setLoading(true);
    setError(undefined);
    api
      .detail(id, abort.signal)
      .then((d) => {
        if (active) setDetail(d);
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
  }, [api, id, reload]);
  async function execute() {
    if (!attempt.current || busy) return;
    const action = attempt.current;
    setBusy(true);
    setMutationError(undefined);
    try {
      await action.run(action.key);
      if (alive.current) {
        attempt.current = null;
        setUncertain(false);
        setNotice('Đã cập nhật mẫu. Đang tải trạng thái mới.');
        setBarcode('');
        setReason('');
        setReload((n) => n + 1);
        onChanged();
      }
    } catch (e) {
      if (alive.current) {
        setMutationError(e);
        if (e instanceof DiagnosticError && [400, 401, 403, 404, 409, 422].includes(e.status)) {
          attempt.current = null;
          setUncertain(false);
        } else setUncertain(true);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function act(run: (key: string) => Promise<{ specimen: Specimen }>) {
    if (attempt.current || busy) return;
    attempt.current = { key: crypto.randomUUID(), run };
    void execute();
  }
  if (loading) return <p role="status">Đang tải order…</p>;
  if (error)
    return (
      <div role="alert">
        {diagnosticMessage(error)}
        <button onClick={() => setReload((n) => n + 1)}>Tải lại order</button>
      </div>
    );
  if (!detail) return null;
  const paid = detail.order.chargeState === 'PAID',
    disabled = busy || uncertain;
  const specimenInput = barcode.trim() ? { barcode: barcode.trim() } : {};
  return (
    <section className="diagnostic-order" aria-label="Chi tiết order">
      <h2>Order {id.slice(0, 8)}</h2>
      <p>
        {states[detail.order.state] ?? detail.order.state} · Phiên bản {detail.order.version}
      </p>
      <p>Hồ sơ {detail.order.patientId}</p>
      <p>
        Phí: {detail.order.chargeState}
        {detail.order.chargeId ? ` · ${detail.order.chargeId}` : ''}
      </p>
      {!paid && (
        <p role="status">
          Chờ đồng bộ thanh toán. Chỉ lấy mẫu khi máy chủ có bằng chứng thanh toán hợp lệ.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {mutationError !== undefined && (
        <div role="alert">
          {diagnosticMessage(mutationError)}
          {uncertain && (
            <button disabled={busy} onClick={() => void execute()}>
              Thử lại thao tác mẫu
            </button>
          )}
        </div>
      )}
      <button disabled={disabled} onClick={() => setReload((n) => n + 1)}>
        Tải lại trạng thái order
      </button>
      {canCollect && (
        <div>
          <label>
            Barcode (để trống để hệ thống cấp)
            <input
              maxLength={120}
              disabled={disabled}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
            />
          </label>
          {detail.specimens.length === 0 && (
            <button
              disabled={disabled || !paid || detail.order.state !== 'PAID'}
              onClick={() => act((key) => apiRef.current.collect(id, specimenInput, key))}
            >
              Lấy mẫu
            </button>
          )}
          {detail.order.state === 'SPECIMEN_REJECTED' && (
            <button
              disabled={disabled || !paid}
              onClick={() => act((key) => apiRef.current.recollect(id, specimenInput, key))}
            >
              Lấy lại mẫu
            </button>
          )}
        </div>
      )}
      <h3>Lịch sử mẫu</h3>
      {detail.specimens.length === 0 ? (
        <p>Chưa lấy mẫu.</p>
      ) : (
        <ul>
          {detail.specimens.map((s) => (
            <li key={s.id}>
              <strong>
                Mẫu #{s.sequence} · {s.barcode}
              </strong>
              <p>
                {s.state} · phiên bản {s.version}
              </p>
              <p>
                Người lấy: {s.collectedBy} · {new Date(s.collectedAt).toLocaleString('vi-VN')}
              </p>
              {s.reasonCode && <p>Lý do từ chối: {s.reasonCode}</p>}
              {canCollect && s.state === 'COLLECTED' && (
                <div>
                  <label>
                    Lý do từ chối mẫu {s.sequence}
                    <input
                      required
                      disabled={disabled}
                      maxLength={100}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={disabled || !reason.trim()}
                    onClick={() => {
                      const input = { reasonCode: reason.trim(), expectedVersion: s.version };
                      act((key) => apiRef.current.reject(s.id, input, key));
                    }}
                  >
                    Từ chối mẫu {s.sequence}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

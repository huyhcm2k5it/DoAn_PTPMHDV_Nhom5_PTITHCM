import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PharmacyApi } from '../types';
import { statusLabel } from '../status';
import { useMedicationPolling } from '../hooks/useMedicationPolling';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import { Loading } from '../../../shared/ui/Loading';
import '../pharmacy.css';
export function PrescriptionDetail({
  api,
  prescriptionId,
}: {
  api: PharmacyApi;
  prescriptionId: string;
}) {
  const { data, error, reload } = useMedicationPolling(api, prescriptionId);
  const [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState<unknown>();
  const [confirming, setConfirming] = useState(false);
  const intention = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  if (error) return <ErrorPanel error={error} onRetry={reload} />;
  if (!data) return <Loading label="Đang tải chi tiết toa thuốc" />;
  const hold = data.holds?.[0];
  const matchedStock = (code: string) =>
    data.stock?.find((item) => item.medicineCode === code);
  const shortage =
    data.prescription?.itemsSnapshot.filter((item) => {
      const stock = matchedStock(item.medicineCode);
      return stock != null && stock.available < item.quantity;
    }) ?? [];
  async function act(action: 'hold' | 'release' | 'reconcile' | 'dispense') {
    if (busy || !data) return;
    const signature = JSON.stringify([
      prescriptionId,
      action,
      data.revision,
      hold?.id,
      hold?.version,
      hold?.attemptNo,
    ]);
    if (intention.current?.signature !== signature)
      intention.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    setActionError(undefined);
    try {
      const key = intention.current!.key;
      if (action === 'hold') await api.hold(prescriptionId, data.revision, key);
      else if (hold && action === 'release')
        await api.release(hold.id, hold.version, key);
      else if (hold && action === 'reconcile')
        await api.reconcile(hold.id, hold.attemptNo, key);
      else if (hold && action === 'dispense')
        await api.dispense(hold.id, hold.version, key);
      intention.current = undefined;
      setConfirming(false);
      reload();
    } catch (caught) {
      setActionError(caught);
      if ((caught as { status?: number }).status === 409) reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="page-content pharmacy quan-workflow">
      <Link className="back-link" to="/staff/pharmacy">
        ← Toa chờ cấp
      </Link>
      <header className="page-heading">
        <div>
          <p className="eyebrow">CẤP PHÁT TOÀN TOA</p>
          <h1>
            {confirming && hold?.status === 'COMMITTED'
              ? 'Xác nhận cấp phát'
              : data.latestHoldState === 'HELD'
                ? 'Phiếu giữ thuốc đang hiệu lực'
                : 'Kiểm tra khả dụng và giữ thuốc'}
          </h1>
          <p className="pharmacy-id">{prescriptionId}</p>
        </div>
        <span className="status-pill" role="status">
          {statusLabel[data.latestHoldState]}
        </span>
      </header>
      {data.view === 'PHARMACY' && data.prescription && (
        <>
          <div className="state-card">
            <h2>Toa đã chốt · phiên bản {data.revision}</h2>
            <div className="pharmacy-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Thuốc</th>
                    <th>Số lượng</th>
                    <th>Khả dụng</th>
                  </tr>
                </thead>
                <tbody>
                  {data.prescription.itemsSnapshot.map((item) => (
                    <tr key={item.medicineCode}>
                      <th scope="row">
                        {item.nameSnapshot || item.medicineCode}
                        {item.doseText && <small>{item.doseText}</small>}
                      </th>
                      <td>{item.quantity}</td>
                      <td>
                        {data.stock?.find(
                          (stock) => stock.medicineCode === item.medicineCode,
                        )?.available ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {hold && (
            <dl className="detail-grid">
              <div>
                <dt>Lần giữ</dt>
                <dd>{hold.attemptNo}</dd>
              </div>
              <div>
                <dt>Tiền thuốc</dt>
                <dd>{hold.amountVnd.toLocaleString('vi-VN')} ₫</dd>
              </div>
              <div>
                <dt>Hạn giữ theo máy chủ</dt>
                <dd>{new Date(hold.expiresAt).toLocaleString('vi-VN')}</dd>
              </div>
              <div>
                <dt>Khoản thu</dt>
                <dd>{hold.chargeId || 'Đang đồng bộ'}</dd>
              </div>
            </dl>
          )}
          {['HELD', 'SETTLEMENT_LOCKED'].includes(data.latestHoldState) && (
            <p className="state-card" role="status">
              Đang chờ xác nhận thanh toán từ quầy thu ngân. Thuốc chỉ được cấp
              khi máy chủ xác nhận sẵn sàng.
            </p>
          )}
          <div className="pharmacy-actions" aria-busy={busy}>
            {['NOT_HELD', 'RELEASED', 'EXPIRED'].includes(
              data.latestHoldState,
            ) && (
              <button
                className="button button-primary"
                disabled={busy || shortage.length > 0}
                onClick={() => act('hold')}
              >
                Giữ toàn toa
              </button>
            )}
            {hold?.status === 'HELD' && (
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() => act('release')}
              >
                Nhả thuốc đang giữ
              </button>
            )}
            {hold && ['HELD', 'SETTLEMENT_LOCKED'].includes(hold.status) && (
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() => act('reconcile')}
              >
                Kiểm tra thanh toán
              </button>
            )}
            {confirming && hold?.status === 'COMMITTED' && (
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Quay lại
              </button>
            )}
            {hold?.status === 'COMMITTED' && (
              <button
                className="button button-primary"
                disabled={busy}
                onClick={() =>
                  confirming ? void act('dispense') : setConfirming(true)
                }
              >
                {confirming
                  ? 'Xác nhận đã bàn giao thuốc'
                  : 'Kiểm tra trước khi cấp phát'}
              </button>
            )}
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={reload}
            >
              Tải lại trạng thái
            </button>
          </div>
        </>
      )}
      {shortage.length > 0 &&
        ['NOT_HELD', 'RELEASED', 'EXPIRED'].includes(data.latestHoldState) && (
          <aside className="state-card quan-shortage" role="alert">
            <h2>Không đủ tồn kho để giữ toàn toa</h2>
            <ul>
              {shortage.map((item) => (
                <li key={item.medicineCode}>
                  {item.nameSnapshot ?? item.medicineCode} · Cần {item.quantity}
                  , khả dụng {matchedStock(item.medicineCode)?.available}
                </li>
              ))}
            </ul>
            <Link to="/staff/pharmacy/stock">Kiểm tra tồn kho →</Link>
          </aside>
        )}
      {data.dispensedAt && (
        <p role="status">
          Đã cấp thuốc lúc {new Date(data.dispensedAt).toLocaleString('vi-VN')}.
        </p>
      )}
      {(actionError as { code?: string } | undefined)?.code ===
      'INSUFFICIENT_STOCK' ? (
        <aside className="state-card quan-shortage" role="alert">
          <h2>Không đủ tồn kho để giữ toàn toa</h2>
          <p>Kiểm tra các thuốc còn thiếu rồi thử giữ toa lại.</p>
          <Link to="/staff/pharmacy/stock" className="button button-secondary">
            Xem tồn kho
          </Link>
        </aside>
      ) : (
        actionError != null && <ErrorPanel error={actionError} />
      )}
    </section>
  );
}

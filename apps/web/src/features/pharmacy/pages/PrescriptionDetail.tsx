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
  const intention = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  if (error) return <ErrorPanel error={error} onRetry={reload} />;
  if (!data) return <Loading label="Đang tải chi tiết toa thuốc" />;
  const hold = data.holds?.[0];
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
      reload();
    } catch (caught) {
      setActionError(caught);
      if ((caught as { status?: number }).status === 409) reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="page-content pharmacy">
      <Link className="back-link" to="/staff/pharmacy/prescriptions">
        ← Toa chờ cấp
      </Link>
      <header className="page-heading">
        <div>
          <p className="eyebrow">CẤP PHÁT TOÀN TOA</p>
          <h1>Chi tiết toa thuốc</h1>
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
            <ul>
              {data.prescription.itemsSnapshot.map((item) => (
                <li key={item.medicineCode}>
                  <strong>{item.nameSnapshot || item.medicineCode}</strong> ·{' '}
                  {item.quantity} đơn vị
                  {item.doseText && <p>{item.doseText}</p>}
                </li>
              ))}
            </ul>
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
                disabled={busy}
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
            {hold?.status === 'COMMITTED' && (
              <button
                className="button button-primary"
                disabled={busy}
                onClick={() => act('dispense')}
              >
                Xác nhận cấp phát
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
      {data.dispensedAt && (
        <p role="status">
          Đã cấp thuốc lúc {new Date(data.dispensedAt).toLocaleString('vi-VN')}.
        </p>
      )}
      {actionError != null && <ErrorPanel error={actionError} />}
    </section>
  );
}

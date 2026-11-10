import { useState } from 'react';
import type { PharmacyApi } from '../types';
import { statusLabel } from '../status';
import { useMedicationPolling } from '../hooks/useMedicationPolling';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import { Loading } from '../../../shared/ui/Loading';
function MedicationStatus({ api, id }: { api: PharmacyApi; id: string }) {
  const { data, error, reload } = useMedicationPolling(api, id);
  if (error) return <ErrorPanel error={error} onRetry={reload} />;
  if (!data) return <Loading label="Đang tải trạng thái thuốc" />;
  return (
    <div className="state-card">
      <h2 role="status">{statusLabel[data.latestHoldState]}</h2>
      {data.dispensedAt && (
        <p>Đã cấp lúc {new Date(data.dispensedAt).toLocaleString('vi-VN')}.</p>
      )}
      <button className="button button-secondary" onClick={reload}>
        Tải lại
      </button>
    </div>
  );
}
export function PatientMedicationStatus({ api }: { api: PharmacyApi }) {
  const [draft, setDraft] = useState(''),
    [id, setId] = useState('');
  return (
    <section className="page-content pharmacy">
      <header className="page-heading">
        <div>
          <p className="eyebrow">THUỐC CỦA TÔI</p>
          <h1>Trạng thái cấp thuốc</h1>
          <p>Tra cứu mã toa trên hồ sơ khám của bạn.</p>
        </div>
      </header>
      <form
        className="search-panel"
        onSubmit={(e) => {
          e.preventDefault();
          setId(draft.trim());
        }}
      >
        <label>
          Mã toa thuốc
          <input
            required
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <button className="button button-primary">Xem trạng thái</button>
      </form>
      {id && <MedicationStatus key={id} api={api} id={id} />}
    </section>
  );
}

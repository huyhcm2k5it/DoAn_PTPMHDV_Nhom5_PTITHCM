import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { PharmacyApi, Prescription } from '../types';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import { Loading } from '../../../shared/ui/Loading';
import { EmptyState } from '../../../shared/ui/EmptyState';
import '../pharmacy.css';
import { PrescriptionDetail } from './PrescriptionDetail';

export function PrescriptionQueue({ api }: { api: PharmacyApi }) {
  const { prescriptionId } = useParams();
  const [page, setPage] = useState(1),
    [generation, setGeneration] = useState(0);
  const [items, setItems] = useState<Prescription[]>(),
    [total, setTotal] = useState(0),
    [error, setError] = useState<unknown>();
  useEffect(() => {
    const controller = new AbortController();
    setItems(undefined);
    setError(undefined);
    api.queue(page, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) {
          setItems(result.items);
          setTotal(result.total);
        }
      },
      (caught) => {
        if (!controller.signal.aborted) setError(caught);
      },
    );
    return () => controller.abort();
  }, [api, page, generation]);
  return (
    <section className="page-content pharmacy quan-workflow">
      <header className="page-heading">
        <div>
          <p className="eyebrow">QUẦY DƯỢC</p>
          <h1>Cấp phát thuốc</h1>
          <p>Đối chiếu đơn thuốc và bàn giao cho người bệnh.</p>
        </div>
        <Link className="text-link" to="/staff/pharmacy/stock">
          Kho thuốc
        </Link>
      </header>
      {error ? (
        <ErrorPanel error={error} onRetry={() => setGeneration((v) => v + 1)} />
      ) : !items ? (
        <Loading label="Đang tải toa thuốc" />
      ) : items.length === 0 && !prescriptionId ? (
        <EmptyState title="Không có toa chờ cấp" />
      ) : (
        <div className="pharmacy-workspace">
          <aside className="state-card prescription-sidebar">
            <h2>Hàng chờ toa đã ký</h2>
            <p className="field-hint">{total} toa thuốc</p>
            {items.map((rx) => {
              const id = rx.prescriptionId ?? rx.id;
              return (
                <Link
                  key={id}
                  aria-current={prescriptionId === id ? 'page' : undefined}
                  className="prescription-option"
                  to={'/staff/pharmacy/prescriptions/' + encodeURIComponent(id)}
                >
                  <strong>{id}</strong>
                  <span>Hồ sơ {rx.patientId}</span>
                  <small>Toa đã ký · Phiên bản {rx.revision}</small>
                </Link>
              );
            })}
          </aside>
          <div className="state-card prescription-main">
            {prescriptionId || items[0] ? (
              <PrescriptionDetail
                key={prescriptionId ?? items[0]?.id}
                api={api}
                prescriptionId={
                  prescriptionId ?? items[0].prescriptionId ?? items[0].id
                }
              />
            ) : (
              <EmptyState title="Chọn toa thuốc cần đối chiếu" />
            )}
          </div>
        </div>
      )}
      <nav className="pagination" aria-label="Phân trang toa thuốc">
        <button
          className="button button-secondary"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          Trước
        </button>
        <span>Trang {page}</span>
        <button
          className="button button-secondary"
          disabled={page * 20 >= total}
          onClick={() => setPage(page + 1)}
        >
          Sau
        </button>
      </nav>
    </section>
  );
}

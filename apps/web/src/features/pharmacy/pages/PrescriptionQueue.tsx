import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PharmacyApi, Prescription } from '../types';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import { Loading } from '../../../shared/ui/Loading';
import { EmptyState } from '../../../shared/ui/EmptyState';
import '../pharmacy.css';
export function PrescriptionQueue({ api }: { api: PharmacyApi }) {
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
    <section className="page-content pharmacy">
      <header className="page-heading">
        <div>
          <p className="eyebrow">QUẦY DƯỢC</p>
          <h1>Toa chờ cấp thuốc</h1>
          <p>Chỉ hiển thị toa đã được bác sĩ chốt.</p>
        </div>
        <Link className="text-link" to="/staff/pharmacy">
          Kho thuốc
        </Link>
      </header>
      {error ? (
        <ErrorPanel error={error} onRetry={() => setGeneration((v) => v + 1)} />
      ) : !items ? (
        <Loading label="Đang tải toa thuốc" />
      ) : items.length === 0 ? (
        <EmptyState title="Không có toa chờ cấp" />
      ) : (
        <div className="profile-grid">
          {items.map((rx) => (
            <article className="state-card" key={rx.id}>
              <h2>Toa {rx.prescriptionId || rx.id}</h2>
              <p>
                Phiên bản {rx.revision} · Hồ sơ {rx.patientId}
              </p>
              <Link
                className="text-link"
                to={
                  '/staff/pharmacy/prescriptions/' +
                  encodeURIComponent(rx.prescriptionId || rx.id)
                }
              >
                Tiếp nhận toa
              </Link>
            </article>
          ))}
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

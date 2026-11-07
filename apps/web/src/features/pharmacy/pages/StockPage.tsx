import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PharmacyApi, StockItem } from '../types';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import { Loading } from '../../../shared/ui/Loading';
import { EmptyState } from '../../../shared/ui/EmptyState';
import '../pharmacy.css';
export function StockPage({ api }: { api: PharmacyApi }) {
  const [items, setItems] = useState<StockItem[]>(),
    [total, setTotal] = useState(0);
  const [page, setPage] = useState(1),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('');
  const [version, setVersion] = useState(0),
    [error, setError] = useState<unknown>();
  const [formError, setFormError] = useState<unknown>(),
    [notice, setNotice] = useState('');
  const [medicineId, setMedicineId] = useState(''),
    [quantity, setQuantity] = useState('1'),
    [batchRef, setBatchRef] = useState('');
  const [busy, setBusy] = useState(false);
  const intention = useRef<{ body: string; key: string } | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    setItems(undefined);
    setError(undefined);
    api.stock({ page, limit: 20, name: filter }, controller.signal).then(
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
  }, [api, page, filter, version]);
  async function receive(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const input = {
      medicineId: medicineId.trim(),
      quantity: Number(quantity),
      batchRef: batchRef.trim(),
    };
    const body = JSON.stringify(input);
    if (intention.current?.body !== body) intention.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setFormError(undefined);
    setNotice('');
    try {
      const result = await api.receiveStock(input, intention.current!.key);
      intention.current = undefined;
      setNotice('Đã ghi nhận phiếu nhập ' + result.stockReceiptId);
      setVersion((value) => value + 1);
    } catch (caught) {
      setFormError(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="page-content pharmacy">
      <header className="page-heading">
        <div>
          <p className="eyebrow">QUẦY DƯỢC</p>
          <h1>Tồn kho thuốc</h1>
          <p>Số lượng khả dụng đã trừ thuốc đang được giữ.</p>
        </div>
        <Link className="text-link" to="/staff/pharmacy/prescriptions">
          Toa chờ cấp
        </Link>
      </header>
      <form
        className="search-panel"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setFilter(query);
        }}
      >
        <label>
          Tìm theo tên thuốc
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button className="button button-secondary">Tìm thuốc</button>
      </form>
      {error ? (
        <ErrorPanel error={error} onRetry={() => setVersion((value) => value + 1)} />
      ) : !items ? (
        <Loading label="Đang tải tồn kho" />
      ) : items.length === 0 ? (
        <EmptyState title="Chưa có thuốc trong kết quả" />
      ) : (
        <div className="pharmacy-table-wrap">
          <table>
            <caption>Tồn kho và lượng đang giữ</caption>
            <thead>
              <tr>
                <th scope="col">Thuốc</th>
                <th scope="col">Tồn tổng</th>
                <th scope="col">Đang giữ</th>
                <th scope="col">Khả dụng</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.medicineId}>
                  <th scope="row">
                    {item.name || item.medicineCode || item.medicineId}
                    <small>{item.medicineCode}</small>
                  </th>
                  <td>{item.onHand}</td>
                  <td>{item.reserved}</td>
                  <td>{item.available}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav className="pagination" aria-label="Phân trang kho thuốc">
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
      <h2>Nhập bổ sung</h2>
      <form className="search-panel" onSubmit={receive} aria-busy={busy}>
        <label>
          Mã thuốc (UUID)
          <input
            required
            value={medicineId}
            disabled={busy}
            onChange={(e) => setMedicineId(e.target.value)}
          />
        </label>
        <label>
          Số lượng nhập
          <input
            required
            type="number"
            min="1"
            max="2147483647"
            step="1"
            value={quantity}
            disabled={busy}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
        <label>
          Mã lô tham chiếu
          <input
            value={batchRef}
            maxLength={200}
            disabled={busy}
            onChange={(e) => setBatchRef(e.target.value)}
          />
        </label>
        <button className="button button-primary" disabled={busy}>
          {busy ? 'Đang ghi nhận…' : 'Nhập tồn'}
        </button>
      </form>
      {formError != null && <ErrorPanel error={formError} />}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

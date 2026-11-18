import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CatalogApi, Medicine } from '../../catalog/types';
import type { PharmacyApi, StockItem } from '../types';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import { Loading } from '../../../shared/ui/Loading';
import { EmptyState } from '../../../shared/ui/EmptyState';
import '../pharmacy.css';
export function StockPage({
  api,
  adjust = false,
  catalog,
}: {
  api: PharmacyApi;
  adjust?: boolean;
  catalog?: Pick<CatalogApi, 'medicines'>;
}) {
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
  const [medicines, setMedicines] = useState<Medicine[]>();
  const chosenMedicine = items?.find((item) => item.medicineId === medicineId);
  const canReceive = medicines?.some((item) => item.id === medicineId);
  useEffect(() => {
    if (!adjust || !catalog) return;
    const controller = new AbortController();
    setMedicines(undefined);
    setFormError(undefined);
    catalog.medicines(filter, controller.signal).then(
      (rows) => {
        if (!controller.signal.aborted)
          setMedicines(rows.filter((row) => row.status === 'ACTIVE'));
      },
      (error) => {
        if (!controller.signal.aborted) setFormError(error);
      },
    );
    return () => controller.abort();
  }, [adjust, catalog, filter]);
  const intention = useRef<{ body: string; key: string } | undefined>(
    undefined,
  );
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
    if (busy || !canReceive) return;
    const input = {
      medicineId: medicineId.trim(),
      quantity: Number(quantity),
      batchRef: batchRef.trim(),
    };
    const body = JSON.stringify(input);
    if (intention.current?.body !== body)
      intention.current = { body, key: crypto.randomUUID() };
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
    <section className="page-content pharmacy quan-workflow">
      <header className="page-heading">
        <div>
          <p className="eyebrow">QUẦY DƯỢC</p>
          <h1>{adjust ? 'Nhập bổ sung tồn kho' : 'Quản lý tồn kho thuốc'}</h1>
          <p>Số lượng khả dụng đã trừ thuốc đang được giữ.</p>
        </div>
        <div className="quan-actions">
          <Link to="/staff/pharmacy">Toa chờ cấp</Link>
          <Link
            className="button button-primary"
            to={
              adjust ? '/staff/pharmacy/stock' : '/staff/pharmacy/stock/adjust'
            }
          >
            {adjust ? 'Xem tồn kho' : 'Nhập bổ sung'}
          </Link>
        </div>
      </header>
      <form
        className="search-panel"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setMedicineId('');
          setFilter(query);
        }}
      >
        <label>
          Tìm theo tên thuốc
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button className="button button-secondary">Tìm thuốc</button>
      </form>
      {adjust && error != null && (
        <ErrorPanel
          error={error}
          onRetry={() => setVersion((value) => value + 1)}
        />
      )}
      {adjust && !error && !items && (
        <Loading label="Đang tải danh mục tồn kho" />
      )}
      {adjust && medicines?.length === 0 && (
        <EmptyState title="Không tìm thấy thuốc" />
      )}
      {!adjust && (
        <>
          {error ? (
            <ErrorPanel
              error={error}
              onRetry={() => setVersion((value) => value + 1)}
            />
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
        </>
      )}
      {adjust && (
        <>
          <form className="search-panel" onSubmit={receive} aria-busy={busy}>
            <label>
              Thuốc trong kết quả tìm kiếm
              <select
                required
                value={medicineId}
                disabled={busy || !medicines?.length}
                onChange={(event) => setMedicineId(event.target.value)}
              >
                <option value="">Chọn thuốc</option>
                {medicines?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.code}
                  </option>
                ))}
              </select>
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
            {chosenMedicine && (
              <p>Khả dụng hiện tại: {chosenMedicine.available}</p>
            )}
            <button
              className="button button-primary"
              disabled={busy || !canReceive}
            >
              {busy ? 'Đang ghi nhận…' : 'Nhập tồn'}
            </button>
          </form>
          {formError != null && <ErrorPanel error={formError} />}
          {notice && <p role="status">{notice}</p>}
        </>
      )}
    </section>
  );
}

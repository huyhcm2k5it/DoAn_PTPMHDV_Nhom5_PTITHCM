import { useEffect, useState } from 'react';
import type { CatalogApi, ItemType, PriceVersion } from './types';
import { errorMessage } from './api';

function dateLabel(value?: string | null) {
  return value ? new Date(value).toLocaleString('vi-VN') : 'Không giới hạn';
}

export function PriceHistory({
  api,
  revision = 0,
}: {
  api: CatalogApi;
  revision?: number;
}) {
  const [type, setType] = useState<ItemType | ''>('');
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{
    loading: boolean;
    items: PriceVersion[];
    total: number;
    error?: unknown;
  }>({ loading: true, items: [], total: 0 });
  useEffect(() => {
    const abort = new AbortController();
    setState({ loading: true, items: [], total: 0 });
    const request =
      api.priceHistory?.(
        { ...(type && { itemType: type }), page, limit: 20 },
        abort.signal,
      ) ?? Promise.reject(new Error('Chưa có kết nối lịch sử giá.'));
    request.then(
      (data) => {
        if (!abort.signal.aborted) setState({ loading: false, ...data });
      },
      (error) => {
        if (!abort.signal.aborted)
          setState({ loading: false, items: [], total: 0, error });
      },
    );
    return () => abort.abort();
  }, [api, type, page, revision, retry]);
  return (
    <section
      className="catalog-price-history"
      aria-labelledby="price-history-heading"
    >
      <h2 id="price-history-heading">Lịch sử phiên bản giá</h2>
      <p className="catalog-note">
        Giá quá khứ, hiện tại và tương lai được giữ theo từng phiên bản. Giá tại
        thời điểm thanh toán do Billing xác nhận.
      </p>
      <label>
        Loại danh mục
        <select
          value={type}
          onChange={(event) => {
            setType(event.target.value as ItemType | '');
            setPage(1);
          }}
        >
          <option value="">Tất cả</option>
          <option value="EXAM">Khám</option>
          <option value="LAB">Xét nghiệm</option>
          <option value="MEDICINE">Thuốc</option>
        </select>
      </label>
      {state.loading ? (
        <p role="status">Đang tải phiên bản giá…</p>
      ) : state.error ? (
        <div role="alert">
          <p>{errorMessage(state.error)}</p>
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Tải lại giá
          </button>
        </div>
      ) : !state.items.length ? (
        <p>Chưa có phiên bản giá phù hợp.</p>
      ) : (
        <div
          className="catalog-table-scroll"
          role="region"
          aria-label="Bảng lịch sử giá"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>Mã / Danh mục</th>
                <th>Loại</th>
                <th>Phiên bản</th>
                <th>Giá VND</th>
                <th>Từ</th>
                <th>Đến</th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((item) => (
                <tr key={item.priceVersionId}>
                  <td>
                    <strong>{item.itemCode}</strong>
                    <br />
                    {item.itemName}
                  </td>
                  <td>{item.itemType}</td>
                  <td>v{item.revision}</td>
                  <td>
                    {Number.isSafeInteger(item.amountVnd)
                      ? item.amountVnd.toLocaleString('vi-VN')
                      : 'Giá vượt giới hạn hiển thị'}
                  </td>
                  <td>{dateLabel(item.effectiveFrom)}</td>
                  <td>{dateLabel(item.effectiveTo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav aria-label="Phân trang phiên bản giá">
        <button
          type="button"
          disabled={state.loading || page === 1}
          onClick={() => setPage((n) => n - 1)}
        >
          Trang trước
        </button>
        <span>
          Trang {page} · {state.total} phiên bản
        </span>
        <button
          type="button"
          disabled={state.loading || !!state.error || page * 20 >= state.total}
          onClick={() => setPage((n) => n + 1)}
        >
          Trang sau
        </button>
      </nav>
    </section>
  );
}

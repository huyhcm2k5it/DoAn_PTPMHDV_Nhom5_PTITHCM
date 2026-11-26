import { useEffect, useState } from 'react';
import type { CatalogApi, Session } from './types';
import { can } from './types';
import { PriceForm, type PriceChoice } from './PriceForm';
import { PriceHistory } from './PriceHistory';
import { errorMessage } from './api';
import './catalog.css';

export function PriceVersionsPage({
  api,
  session,
}: {
  api: CatalogApi;
  session?: Session;
}) {
  const [revision, setRevision] = useState(0);
  const [reload, setReload] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [state, setState] = useState<{
    pending: boolean;
    choices: PriceChoice[];
    error?: unknown;
  }>({ pending: true, choices: [] });
  const allowed = can(session, 'ADMIN');
  useEffect(() => {
    if (!allowed) return;
    const abort = new AbortController();
    setState({ pending: true, choices: [] });
    Promise.all([
      api.services('', abort.signal),
      api.labTests('', abort.signal),
      api.medicines('', abort.signal),
    ]).then(
      ([services, tests, medicines]) => {
        if (!abort.signal.aborted)
          setState({
            pending: false,
            choices: [
              ...services.map((item) => ({
                type: 'EXAM' as const,
                id: item.id,
                name: `${item.code} · ${item.name}`,
              })),
              ...tests.map((item) => ({
                type: 'LAB' as const,
                id: item.id,
                name: `${item.code} · ${item.name}`,
              })),
              ...medicines.map((item) => ({
                type: 'MEDICINE' as const,
                id: item.id,
                name: `${item.code} · ${item.name}`,
              })),
            ],
          });
      },
      (error) => {
        if (!abort.signal.aborted)
          setState({ pending: false, choices: [], error });
      },
    );
    return () => abort.abort();
  }, [api, allowed, reload]);
  if (!allowed)
    return (
      <section className="umc-catalog" role="alert">
        Cần tài khoản nhân viên có quyền ADMIN để quản lý giá.
      </section>
    );
  return (
    <section className="umc-catalog" aria-labelledby="price-page-title">
      <header>
        <p className="catalog-eyebrow">QUẢN TRỊ · CATALOG</p>
        <h1 id="price-page-title">Phiên bản giá</h1>
        <p>
          Tạo giá cho danh mục đã có. Mỗi phiên bản giữ nguyên lịch sử và khoảng
          hiệu lực.
        </p>
      </header>
      <button
        type="button"
        onClick={() => setShowForm((value) => !value)}
        aria-expanded={showForm}
      >
        {showForm ? 'Đóng biểu mẫu' : 'Tạo phiên bản giá'}
      </button>
      {showForm &&
        (state.pending ? (
          <p role="status">Đang tải danh mục…</p>
        ) : state.error ? (
          <div role="alert">
            <p>{errorMessage(state.error)}</p>
            <button type="button" onClick={() => setReload((n) => n + 1)}>
              Tải lại danh mục
            </button>
          </div>
        ) : (
          <PriceForm
            api={api}
            choices={state.choices}
            onSaved={() => setRevision((n) => n + 1)}
          />
        ))}
      <PriceHistory api={api} revision={revision} />
    </section>
  );
}

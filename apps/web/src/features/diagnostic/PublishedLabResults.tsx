import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import type { DiagnosticApi, LabResult } from './types';
import { diagnosticMessage } from './api';
import {
  Empty,
  Loading,
  Notice,
  shortId,
  timeLabel,
} from '../clinical/ClinicalUI';

export function PublishedLabResults({
  api,
  patientId,
}: {
  api: DiagnosticApi;
  patientId: string;
}) {
  const [page, setPage] = useState(1),
    [reload, setReload] = useState(0);
  const [data, setData] = useState<{ items: LabResult[]; total: number }>({
    items: [],
    total: 0,
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<unknown>();
  useEffect(() => {
    setPage(1);
    setData({ items: [], total: 0 });
  }, [patientId]);
  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    setLoading(true);
    setError(undefined);
    const request =
      api.publishedResults?.(patientId, page, 10, abort.signal) ??
      Promise.reject(new Error('Results adapter unavailable'));
    request
      .then((value) => {
        if (active) setData(value);
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
  }, [api, patientId, page, reload]);
  if (loading) return <Loading>Đang tải kết quả xét nghiệm…</Loading>;
  if (error)
    return (
      <Notice tone="error">
        {diagnosticMessage(error)}
        <button type="button" onClick={() => setReload((n) => n + 1)}>
          Tải lại kết quả
        </button>
      </Notice>
    );
  return (
    <section
      className="huy-published-results"
      aria-label="Kết quả xét nghiệm đã công bố"
    >
      {!data.items.length ? (
        <Empty>Chưa có kết quả xét nghiệm đã công bố.</Empty>
      ) : (
        data.items
          .filter((result) => result.state === 'PUBLISHED')
          .map((result) => (
            <article className="huy-history-record" key={result.id}>
              <div className="huy-section-title">
                <div>
                  <h3>Kết quả xét nghiệm #{shortId(result.orderId)}</h3>
                  <p className="huy-muted">
                    Công bố lúc {timeLabel(result.publishedAt)} · Lần{' '}
                    {result.revision}
                  </p>
                </div>
                <span className="huy-badge success">Đã công bố</span>
              </div>
              <ResultTable result={result} />
              <button
                type="button"
                className="huy-button secondary huy-no-print"
                onClick={(event) => {
                  const section = event.currentTarget.closest('article');
                  section?.classList.add('huy-print-target');
                  window.print();
                  section?.classList.remove('huy-print-target');
                }}
              >
                <Printer size={16} aria-hidden="true" />
                In kết quả
              </button>
            </article>
          ))
      )}
      <nav className="huy-pagination" aria-label="Phân trang kết quả">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((n) => n - 1)}
        >
          Trước
        </button>
        <span>
          Trang {page} · {data.total} kết quả
        </span>
        <button
          type="button"
          disabled={page * 10 >= data.total}
          onClick={() => setPage((n) => n + 1)}
        >
          Sau
        </button>
      </nav>
    </section>
  );
}
export function ResultTable({ result }: { result: LabResult }) {
  return (
    <div className="huy-table-scroll">
      <table className="huy-table">
        <thead>
          <tr>
            <th>Chỉ số</th>
            <th>Kết quả</th>
            <th>Tham chiếu</th>
            <th>Đơn vị</th>
          </tr>
        </thead>
        <tbody>
          {result.items.map((item) => (
            <tr key={item.id || item.testCode}>
              <td>{item.testCode}</td>
              <td
                className={
                  item.flag && item.flag !== 'NORMAL' ? 'huy-abnormal' : ''
                }
              >
                {item.valueText}{' '}
                {item.flag === 'HIGH'
                  ? '↑'
                  : item.flag === 'LOW'
                    ? '↓'
                    : item.flag && item.flag !== 'NORMAL'
                      ? item.flag
                      : ''}
              </td>
              <td>{item.referenceRange || '—'}</td>
              <td>{item.unit || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

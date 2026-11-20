import { useEffect, useState } from 'react';
import { FileText, Printer } from 'lucide-react';
import type { ClinicalApi, MedicalRecord, Prescription } from './types';
import { Empty, Loading, Notice, shortId, timeLabel } from './ClinicalUI';
import { errorMessage } from './api';

export function SignedPrescription({
  prescription,
}: {
  prescription: Prescription;
}) {
  if (prescription.state !== 'FINAL')
    return <Empty>Toa thuốc chưa được ký.</Empty>;
  return (
    <article className="huy-signed-prescription">
      <div className="huy-section-title">
        <div>
          <h3>Toa thuốc đã ký</h3>
          <p className="huy-muted">
            #{shortId(prescription.id)} · Lần kê {prescription.revision}
          </p>
        </div>
        <span className="huy-badge success">Đã ký · Chỉ đọc</span>
      </div>
      <div className="huy-table-scroll">
        <table className="huy-table">
          <thead>
            <tr>
              <th>Thuốc</th>
              <th>Liều dùng</th>
              <th>Số lượng</th>
              <th>Lời dặn</th>
            </tr>
          </thead>
          <tbody>
            {prescription.lines.map((line) => (
              <tr key={line.medicineCode}>
                <td>
                  <strong>{line.nameSnapshot || line.medicineCode}</strong>
                  <small>{line.medicineCode}</small>
                </td>
                <td>{line.doseText}</td>
                <td>{line.quantity}</td>
                <td>{line.instruction || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {prescription.finalizedAt && (
        <p className="huy-muted">
          Ký lúc {timeLabel(prescription.finalizedAt)}
        </p>
      )}
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
        In toa thuốc
      </button>
    </article>
  );
}

export function MedicalHistory({
  api,
  patientId,
}: {
  api: ClinicalApi;
  patientId: string;
}) {
  const [page, setPage] = useState(1),
    [reload, setReload] = useState(0);
  const [data, setData] = useState<{ items: MedicalRecord[]; total: number }>({
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
      api.medicalRecords?.(patientId, page, 10, abort.signal) ??
      Promise.reject(new Error('Records adapter unavailable'));
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
  if (loading) return <Loading>Đang tải lịch sử khám…</Loading>;
  if (error)
    return (
      <Notice tone="error">
        {errorMessage(error)}
        <button type="button" onClick={() => setReload((n) => n + 1)}>
          Tải lại lịch sử
        </button>
      </Notice>
    );
  return (
    <section className="huy-medical-history" aria-label="Lịch sử khám đã ký">
      {!data.items.length ? (
        <Empty>Chưa có bệnh án đã ký được phép xem.</Empty>
      ) : (
        data.items
          .filter((record) => record.visit.state === 'SIGNED')
          .map((record) => (
            <article className="huy-history-record" key={record.visit.id}>
              <header>
                <FileText size={20} aria-hidden="true" />
                <div>
                  <h3>Lượt khám {shortId(record.visit.id)}</h3>
                  <p className="huy-muted">
                    {timeLabel(record.visit.signedAt)}
                  </p>
                </div>
                <span className="huy-badge success">Đã ký</span>
              </header>
              <dl>
                <dt>Lý do khám & bệnh sử</dt>
                <dd>{record.note.symptoms || 'Chưa ghi nhận'}</dd>
                <dt>Khám lâm sàng</dt>
                <dd>{record.note.findings || 'Chưa ghi nhận'}</dd>
                <dt>Đánh giá</dt>
                <dd>{record.note.assessment || 'Chưa ghi nhận'}</dd>
                <dt>Chẩn đoán</dt>
                <dd>{record.note.diagnosis || 'Chưa ghi nhận'}</dd>
              </dl>
              {record.prescriptions
                .filter((p) => p.state === 'FINAL')
                .map((p) => (
                  <SignedPrescription key={p.id} prescription={p} />
                ))}
            </article>
          ))
      )}
      <nav className="huy-pagination" aria-label="Phân trang lịch sử khám">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((n) => n - 1)}
        >
          Trước
        </button>
        <span>
          Trang {page} · {data.total} lượt
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

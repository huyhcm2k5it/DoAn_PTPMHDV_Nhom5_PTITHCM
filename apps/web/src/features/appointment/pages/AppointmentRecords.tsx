import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SignedPrescription } from '../../clinical/MedicalHistory';
import type { ClinicalApi, MedicalRecord } from '../../clinical/types';
import { ResultTable } from '../../diagnostic/PublishedLabResults';
import type { DiagnosticApi, LabResult } from '../../diagnostic/types';
import { Loading } from '../../../shared/ui/Loading';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';

export function AppointmentRecords({
  appointmentId,
  patientId,
  returnTo,
  view,
  clinical,
  diagnostic,
}: {
  appointmentId: string;
  patientId: string;
  returnTo?: string;
  view: 'lab' | 'prescription';
  clinical: ClinicalApi;
  diagnostic: DiagnosticApi;
}) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    loading: boolean;
    record?: MedicalRecord;
    results?: LabResult[];
    error?: unknown;
  }>({ loading: true });
  useEffect(() => {
    const abort = new AbortController();
    const { signal } = abort;
    setState({ loading: true });
    async function load() {
      const list = clinical.medicalRecords;
      if (!list) throw new Error('Dịch vụ bệnh án chưa sẵn sàng.');
      let record: MedicalRecord | undefined;
      const limit = 50;
      for (let page = 1; ; page++) {
        const data = await list(patientId, page, limit, signal);
        record = data.items.find(
          (item) =>
            item.visit.appointmentId === appointmentId &&
            item.visit.state === 'SIGNED',
        );
        if (record || !data.items.length || page * limit >= data.total) break;
      }
      const orderIds = new Set(
        record?.publishedLabResults.map((item) => item.orderId),
      );
      const results: LabResult[] = [];
      if (view === 'lab' && orderIds.size) {
        const published = diagnostic.publishedResults;
        if (!published)
          throw new Error('Dịch vụ kết quả xét nghiệm chưa sẵn sàng.');
        for (let page = 1; ; page++) {
          const data = await published(patientId, page, limit, signal);
          results.push(
            ...data.items.filter(
              (item) =>
                orderIds.has(item.orderId) && item.state === 'PUBLISHED',
            ),
          );
          if (
            !data.items.length ||
            page * limit >= data.total ||
            new Set(results.map((item) => item.orderId)).size === orderIds.size
          )
            break;
        }
      }
      return { loading: false, record, results };
    }
    load().then(
      (data) => {
        if (!signal.aborted) setState(data);
      },
      (error) => {
        if (!signal.aborted) setState({ loading: false, error });
      },
    );
    return () => abort.abort();
  }, [appointmentId, patientId, view, clinical, diagnostic, revision]);
  if (state.loading) return <Loading label="Đang tải dữ liệu lượt khám" />;
  if (state.error)
    return (
      <ErrorPanel
        error={state.error}
        onRetry={() => setRevision((value) => value + 1)}
      />
    );
  if (view === 'lab') {
    return (
      <section
        className="state-card huy-workspace"
        aria-label="Kết quả xét nghiệm của lịch"
      >
        <h2>Kết quả xét nghiệm đã công bố</h2>
        {state.results?.map((result) => (
          <article key={result.id} className="huy-history-record">
            <h3>Kết quả #{result.orderId.slice(0, 8)}</h3>
            <ResultTable result={result} />
          </article>
        ))}
        {!state.results?.length && (
          <EmptyState
            title="Chưa có kết quả gắn với lịch này"
            description="Bạn có thể kiểm tra kết quả đã công bố theo hồ sơ người khám."
          />
        )}
        <Link
          className="button button-secondary"
          to={
            '/patient/lab-results?patientId=' +
            encodeURIComponent(patientId) +
            (returnTo ? '&returnTo=' + encodeURIComponent(returnTo) : '')
          }
        >
          Xem kết quả theo hồ sơ
        </Link>
      </section>
    );
  }
  const prescriptions =
    state.record?.prescriptions.filter((item) => item.state === 'FINAL') ?? [];
  return (
    <section
      className="state-card huy-workspace"
      aria-label="Đơn thuốc của lịch"
    >
      <h2>Toa thuốc đã ký</h2>
      {!prescriptions.length && (
        <EmptyState title="Chưa có toa thuốc đã ký cho lịch này" />
      )}
      {prescriptions.map((item) => (
        <div key={item.id}>
          <SignedPrescription prescription={item} />
          <Link
            className="button button-secondary"
            to={
              '/patient/medications?prescriptionId=' +
              encodeURIComponent(item.id)
            }
          >
            Xem trạng thái cấp thuốc
          </Link>
        </div>
      ))}
    </section>
  );
}

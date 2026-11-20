import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { PatientApi, PatientProfile } from '../patient/types';
import type { ClinicalApi } from './types';
import type { DiagnosticApi } from '../diagnostic/types';
import { MedicalHistory } from './MedicalHistory';
import { PublishedLabResults } from '../diagnostic/PublishedLabResults';
import { Empty, Loading, Notice } from './ClinicalUI';

export function PatientRecordsRoute({
  patientApi,
  clinicalApi,
  diagnosticApi,
  kind,
}: {
  patientApi: PatientApi;
  clinicalApi: ClinicalApi;
  diagnosticApi: DiagnosticApi;
  kind: 'results' | 'records';
}) {
  const [params, setParams] = useSearchParams();
  const [patients, setPatients] = useState<PatientProfile[]>([]),
    [selected, setSelected] = useState(params.get('patientId') ?? '');
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [reload, setReload] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    setLoading(true);
    setError(false);
    patientApi
      .list(1, 100, abort.signal)
      .then((value) => {
        if (active) {
          setPatients(value.items);
          setSelected((current) =>
            value.items.some((p) => p.id === current)
              ? current
              : (value.items[0]?.id ?? ''),
          );
        }
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [patientApi, reload]);
  const query = selected ? '?patientId=' + encodeURIComponent(selected) : '';
  return (
    <section className="huy-workspace">
      <header className="huy-page-heading">
        <div>
          <p className="huy-eyebrow">HỒ SƠ SỨC KHỎE</p>
          <h1>
            {kind === 'results' ? 'Kết quả xét nghiệm' : 'Bệnh án & toa thuốc'}
          </h1>
          <p>
            {kind === 'results'
              ? 'Xem kết quả đã được duyệt và công bố.'
              : 'Xem thông tin khám và toa thuốc đã ký.'}
          </p>
        </div>
      </header>
      <section className="huy-paper">
        <nav className="huy-view-switch" aria-label="Hồ sơ sức khỏe">
          <Link
            className="huy-button secondary"
            to={'/patient/lab-results' + query}
          >
            Kết quả xét nghiệm
          </Link>
          <Link
            className="huy-button secondary"
            to={'/patient/medical-records' + query}
          >
            Bệnh án & toa thuốc
          </Link>
        </nav>
        {loading ? (
          <Loading />
        ) : error ? (
          <Notice tone="error">
            Không tải được danh sách hồ sơ.
            <button type="button" onClick={() => setReload((n) => n + 1)}>
              Thử lại
            </button>
          </Notice>
        ) : !patients.length ? (
          <Empty>Chưa có hồ sơ bệnh nhân để xem kết quả.</Empty>
        ) : (
          <>
            <label>
              Hồ sơ bệnh nhân
              <select
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setParams({ patientId: e.target.value }, { replace: true });
                }}
              >
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </select>
            </label>
            {kind === 'results' ? (
              <PublishedLabResults
                key={selected}
                api={diagnosticApi}
                patientId={selected}
              />
            ) : (
              <MedicalHistory
                key={selected}
                api={clinicalApi}
                patientId={selected}
              />
            )}
          </>
        )}
      </section>
    </section>
  );
}

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
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(false);
    setPatients([]);
    async function loadProfiles() {
      const items: PatientProfile[] = [];
      for (let page = 1; ; page++) {
        const data = await patientApi.list(page, 100, abort.signal);
        if (abort.signal.aborted) return [];
        items.push(...data.items.filter((p) => p.active !== false));
        if (!data.items.length || page * 100 >= data.total) break;
      }
      return items;
    }
    loadProfiles()
      .then(
        (value) => {
          if (!abort.signal.aborted) setPatients(value);
        },
        () => {
          if (!abort.signal.aborted) setError(true);
        },
      )
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [patientApi, reload]);
  // URL selection is authoritative so browser back/forward and sibling tabs agree.
  const requested = params.get('patientId');
  const selected =
    requested ??
    patients.find((p) => p.relation === 'SELF')?.id ??
    patients[0]?.id ??
    '';
  const patient = patients.find((p) => p.id === selected);
  const query = selected
    ? '?' + new URLSearchParams({ patientId: selected })
    : '';
  const requestedBack = params.get('returnTo');
  const appointments =
    requestedBack?.startsWith('/patient/appointments') &&
    !requestedBack.startsWith('//')
      ? requestedBack
      : '/patient/appointments' + query;
  return (
    <section className="huy-workspace huy-patient-records">
      <header className="huy-page-heading">
        <div>
          <p className="huy-eyebrow">HỒ SƠ SỨC KHỎE</p>
          <h1>
            {kind === 'results' ? 'Kết quả xét nghiệm' : 'Đơn thuốc đã ký'}
          </h1>
          <p>
            {patient ? `${patient.fullName} · ` : ''}
            {kind === 'results'
              ? 'Chỉ hiển thị kết quả đã được duyệt và công bố.'
              : 'Chỉ hiển thị toa FINAL, không chỉnh sửa nội dung đã ký.'}
          </p>
        </div>
      </header>
      <nav className="huy-record-tabs" aria-label="Lịch khám và hồ sơ sức khỏe">
        <Link to={appointments}>Lịch hẹn của tôi</Link>
        <Link
          to={'/patient/lab-results' + query}
          aria-current={kind === 'results' ? 'page' : undefined}
        >
          Kết quả xét nghiệm
        </Link>
        <Link
          to={'/patient/medical-records' + query}
          aria-current={kind === 'records' ? 'page' : undefined}
        >
          Đơn thuốc
        </Link>
      </nav>
      {loading ? (
        <Loading />
      ) : error ? (
        <Notice tone="error">
          Không tải được danh sách hồ sơ.{' '}
          <button type="button" onClick={() => setReload((n) => n + 1)}>
            Thử lại
          </button>
        </Notice>
      ) : !patients.length ? (
        <Empty>
          Chưa có hồ sơ bệnh nhân để xem kết quả.{' '}
          <Link to="/patient/profiles/new">Tạo hồ sơ người khám</Link>
        </Empty>
      ) : (
        <>
          <div className="huy-record-context">
            <label>
              Hồ sơ người khám
              <select
                value={selected}
                onChange={(e) =>
                  setParams({ patientId: e.target.value }, { replace: true })
                }
              >
                {!patient && (
                  <option value={selected}>Chọn lại hồ sơ được phép xem</option>
                )}
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName} ·{' '}
                    {p.relation === 'SELF' ? 'Bản thân' : 'Người thân'}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!patient ? (
            <Notice tone="warning">
              Hồ sơ trên đường dẫn không thuộc danh sách đang được phép xem. Vui
              lòng chọn lại hồ sơ.
            </Notice>
          ) : (
            <div className="huy-patient-record-grid">
              <div className="huy-paper">
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
                    prescriptionsOnly
                  />
                )}
              </div>
              <aside
                className="huy-paper huy-record-summary"
                aria-label="Thông tin hồ sơ đang xem"
              >
                <h2>
                  {kind === 'results'
                    ? 'Thông tin công bố'
                    : 'Xác thực toa thuốc'}
                </h2>
                <strong>{patient.fullName}</strong>
                <p>
                  {patient.relation === 'SELF'
                    ? 'Hồ sơ bản thân'
                    : 'Hồ sơ người thân'}
                </p>
                <p className="huy-muted">
                  Đang xem toàn bộ dữ liệu đã công bố của hồ sơ này. Để xem theo
                  từng lịch khám, chọn lịch trong Lịch hẹn của tôi.
                </p>
                <p className="huy-muted">
                  {kind === 'results'
                    ? 'Kết quả đã công bố chỉ được đọc. Tên người nhập hoặc người duyệt chỉ hiển thị khi hệ thống cung cấp.'
                    : 'Toa đã ký chưa đồng nghĩa đã nhận thuốc. Trạng thái giữ và cấp thuốc do nhà thuốc xác nhận.'}
                </p>
                <Link className="huy-button secondary" to={appointments}>
                  Quay lại lịch khám
                </Link>
                {kind === 'records' && (
                  <Link
                    className="huy-button secondary"
                    to="/patient/medications"
                  >
                    Xem trạng thái cấp thuốc
                  </Link>
                )}
              </aside>
            </div>
          )}
        </>
      )}
    </section>
  );
}

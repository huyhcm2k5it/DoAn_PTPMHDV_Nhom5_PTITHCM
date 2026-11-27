import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  Pill,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { PharmacyApi } from '../types';
import type { PatientApi, PatientProfile } from '../../patient/types';
import type {
  ClinicalApi,
  MedicalRecord,
  Prescription,
} from '../../clinical/types';
import { SignedPrescription } from '../../clinical/MedicalHistory';
import { statusLabel } from '../status';
import { useMedicationPolling } from '../hooks/useMedicationPolling';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import { Loading } from '../../../shared/ui/Loading';
import './patient-medications.css';

const dateLabel = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat('vi-VN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Ho_Chi_Minh',
      }).format(new Date(value))
    : 'Toa thuốc đã ký';
const descriptions = {
  NOT_HELD:
    'Toa đã được ký. Vui lòng đến quầy dược để được kiểm tra và chuẩn bị thuốc.',
  HELD: 'Quầy dược đang giữ thuốc cho toa của bạn. Hoàn tất thanh toán theo hướng dẫn tại quầy.',
  SETTLEMENT_LOCKED:
    'Hệ thống đang đối soát thanh toán. Vui lòng chờ xác nhận trước khi nhận thuốc.',
  COMMITTED:
    'Thuốc đã sẵn sàng. Bạn có thể đến quầy dược để nhận thuốc theo hướng dẫn.',
  DISPENSED:
    'Quầy dược đã bàn giao thuốc. Sử dụng thuốc đúng liều và lời dặn trong toa.',
  RELEASED:
    'Lần giữ thuốc trước đã được nhả. Liên hệ quầy dược để kiểm tra và chuẩn bị lại.',
  EXPIRED:
    'Lần giữ thuốc đã hết hạn. Quầy dược cần kiểm tra lại tồn kho trước khi cấp thuốc.',
};
function MedicationStatus({ api, id }: { api: PharmacyApi; id: string }) {
  const { data, error, reload } = useMedicationPolling(api, id);
  if (error) return <ErrorPanel error={error} onRetry={reload} />;
  if (!data)
    return (
      <div className="med-status-loading">
        <Loading label="Đang tải trạng thái cấp thuốc" />
      </div>
    );
  const complete = data.latestHoldState === 'DISPENSED';
  const active = complete
    ? 3
    : data.latestHoldState === 'COMMITTED'
      ? 2
      : ['HELD', 'SETTLEMENT_LOCKED'].includes(data.latestHoldState)
        ? 1
        : 0;
  return (
    <section
      className={'med-status-card' + (complete ? ' is-dispensed' : '')}
      aria-label="Trạng thái cấp thuốc"
    >
      <div className="med-status-heading">
        <span className="med-status-icon">
          {complete ? <CheckCircle2 size={25} /> : <Clock3 size={25} />}
        </span>
        <div>
          <p className="med-section-label">TRẠNG THÁI TẠI QUẦY DƯỢC</p>
          <h2 role="status">{statusLabel[data.latestHoldState]}</h2>
        </div>
        <button
          className="med-refresh"
          onClick={reload}
          aria-label="Cập nhật trạng thái cấp thuốc"
        >
          <RefreshCw size={16} />
          Cập nhật
        </button>
      </div>
      <p className="med-status-description">
        {descriptions[data.latestHoldState]}
      </p>
      <ol className="med-progress" aria-label="Tiến trình nhận thuốc">
        {['Toa đã ký', 'Chuẩn bị thuốc', 'Sẵn sàng nhận', 'Đã cấp thuốc'].map(
          (label, index) => (
            <li
              key={label}
              className={index <= active ? 'is-reached' : ''}
              aria-current={index === active ? 'step' : undefined}
            >
              <span>
                {index < active || complete ? <Check size={13} /> : index + 1}
              </span>
              <small>{label}</small>
            </li>
          ),
        )}
      </ol>
      {data.dispensedAt && (
        <p className="med-dispensed-at">
          <CheckCircle2 size={15} /> Đã nhận thuốc lúc{' '}
          {dateLabel(data.dispensedAt)}
        </p>
      )}
    </section>
  );
}
export function PatientMedicationStatus({
  api,
  patientApi,
  clinicalApi,
}: {
  api: PharmacyApi;
  patientApi?: PatientApi;
  clinicalApi?: ClinicalApi;
}) {
  const [params, setParams] = useSearchParams();
  const id = params.get('prescriptionId') ?? '';
  const patientId = params.get('patientId') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [draft, setDraft] = useState(id);
  const [profiles, setProfiles] = useState<PatientProfile[]>();
  const [profileError, setProfileError] = useState<unknown>();
  const [retry, setRetry] = useState(0);
  const [records, setRecords] = useState<{
    key: string;
    items?: MedicalRecord[];
    total?: number;
    error?: unknown;
  }>();
  const recordKey = patientId + ':' + page;
  useEffect(() => {
    setDraft(id);
  }, [id]);
  useEffect(() => {
    if (!patientApi) return;
    const c = new AbortController();
    setProfiles(undefined);
    setProfileError(undefined);
    async function load() {
      const all: PatientProfile[] = [];
      for (let p = 1; ; p++) {
        const data = await patientApi!.list(p, 100, c.signal);
        all.push(...data.items.filter((x) => x.active !== false));
        if (!data.items.length || p * 100 >= data.total) break;
      }
      return all;
    }
    load().then(
      (items) => {
        if (!c.signal.aborted) setProfiles(items);
      },
      (error) => {
        if (!c.signal.aborted) setProfileError(error);
      },
    );
    return () => c.abort();
  }, [patientApi, retry]);
  useEffect(() => {
    if (patientId || id || !profiles?.length) return;
    const initial = profiles.find((x) => x.relation === 'SELF') ?? profiles[0];
    setParams({ patientId: initial.id }, { replace: true });
  }, [profiles, patientId, id, setParams]);
  const profile = profiles?.find((x) => x.id === patientId);
  useEffect(() => {
    if (!patientId || !profile) return;
    const c = new AbortController();
    setRecords({ key: recordKey });
    if (!clinicalApi?.medicalRecords) {
      setRecords({
        key: recordKey,
        error: new Error('Chưa có dịch vụ danh sách toa đã ký.'),
      });
      return;
    }
    clinicalApi.medicalRecords(patientId, page, 10, c.signal).then(
      (data) => {
        if (!c.signal.aborted) setRecords({ key: recordKey, ...data });
      },
      (error) => {
        if (!c.signal.aborted) setRecords({ key: recordKey, error });
      },
    );
    return () => c.abort();
  }, [clinicalApi, patientId, profile, recordKey, page, retry]);
  const current = records?.key === recordKey ? records : undefined;
  const prescriptions = current?.items
    ?.filter((x) => x.visit.state === 'SIGNED')
    .flatMap((x) => x.prescriptions.filter((rx) => rx.state === 'FINAL'));
  const selected: Prescription | undefined = prescriptions?.find(
    (x) => x.id === id,
  );
  function selectPrescription(rx: Prescription) {
    setParams({ patientId, prescriptionId: rx.id, page: String(page) });
  }
  return (
    <section className="page-content quan-workflow patient-medication-page">
      <header className="page-heading med-page-heading">
        <div>
          <p className="eyebrow">HỒ SƠ SỨC KHỎE</p>
          <h1>Đơn thuốc của tôi</h1>
          <p>Xem toa đã ký và theo dõi việc nhận thuốc tại quầy dược.</p>
        </div>
        <Link
          className="button button-secondary"
          to={
            '/patient/medical-records' +
            (patientId ? '?patientId=' + encodeURIComponent(patientId) : '')
          }
        >
          <FileText size={16} />
          Xem toa đã ký
          <ArrowRight size={15} />
        </Link>
      </header>
      <div className="med-workspace">
        <aside className="med-sidebar">
          <section className="med-panel med-profile-panel">
            <div className="med-panel-heading">
              <span className="med-small-icon">
                <Users size={18} />
              </span>
              <h2>Người khám</h2>
            </div>
            {profileError ? (
              <ErrorPanel
                error={profileError}
                onRetry={() => setRetry((x) => x + 1)}
              />
            ) : patientApi && !profiles ? (
              <Loading label="Đang tải hồ sơ" />
            ) : (
              <>
                <label htmlFor="med-profile">Chọn hồ sơ để xem đơn thuốc</label>
                <select
                  id="med-profile"
                  value={patientId}
                  onChange={(e) => {
                    setDraft('');
                    setParams(
                      e.target.value ? { patientId: e.target.value } : {},
                    );
                  }}
                >
                  <option value="">Chọn người khám</option>
                  {profiles?.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.fullName} ·{' '}
                      {x.relation === 'SELF' ? 'Bản thân' : 'Người thân'}
                    </option>
                  ))}
                </select>
                {profile && (
                  <p className="med-profile-caption">
                    <ShieldCheck size={14} />
                    {profile.relation === 'SELF'
                      ? 'Hồ sơ bản thân'
                      : 'Hồ sơ người thân'}{' '}
                    · {profile.birthDate}
                  </p>
                )}
                {patientId && profiles && !profile && (
                  <p role="alert" className="med-error">
                    Hồ sơ này không thuộc danh sách được phép xem.
                  </p>
                )}
              </>
            )}
          </section>
          <section className="med-panel med-list-panel">
            <div className="med-panel-heading">
              <h2>Toa thuốc đã ký</h2>
              <span className="med-list-count">
                {prescriptions?.length ?? '—'}
              </span>
            </div>
            <p className="med-muted">Các toa trong trang bệnh án đang xem</p>
            {!patientId ? (
              <p className="med-sidebar-empty">
                Chọn người khám để tải danh sách toa.
              </p>
            ) : current?.error ? (
              <ErrorPanel
                error={current.error}
                onRetry={() => setRetry((x) => x + 1)}
              />
            ) : profile && !current?.items ? (
              <Loading label="Đang tải toa thuốc" />
            ) : (
              <>
                {prescriptions?.map((rx) => (
                  <button
                    key={rx.id}
                    className={
                      'med-prescription-option' +
                      (id === rx.id ? ' is-selected' : '')
                    }
                    onClick={() => selectPrescription(rx)}
                    aria-pressed={id === rx.id}
                  >
                    <span className="med-rx-icon">
                      <FileText size={18} />
                    </span>
                    <span className="med-rx-copy">
                      <strong>Toa #{rx.id.slice(0, 8).toUpperCase()}</strong>
                      <small>{dateLabel(rx.finalizedAt)}</small>
                      <span>{rx.lines.length} loại thuốc · Đã ký</span>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))}
                {prescriptions?.length === 0 && (
                  <div className="med-sidebar-empty">
                    <FileText size={25} />
                    <p>Chưa có toa đã ký trong trang này.</p>
                    <span>
                      Chỉ toa đã được bác sĩ ký mới xuất hiện tại đây.
                    </span>
                  </div>
                )}
                {current?.total != null && current.total > 10 && (
                  <nav
                    className="pagination"
                    aria-label="Phân trang bệnh án có toa"
                  >
                    <button
                      disabled={page === 1}
                      onClick={() =>
                        setParams({ patientId, page: String(page - 1) })
                      }
                    >
                      Trước
                    </button>
                    <span>Trang {page}</span>
                    <button
                      disabled={page * 10 >= current.total}
                      onClick={() =>
                        setParams({ patientId, page: String(page + 1) })
                      }
                    >
                      Sau
                    </button>
                  </nav>
                )}
              </>
            )}
          </section>
          <details className="med-code-lookup">
            <summary>
              <Search size={15} />
              Tra cứu bằng mã toa
            </summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const value = draft.trim();
                if (value)
                  setParams({
                    ...(patientId ? { patientId } : {}),
                    prescriptionId: value,
                    page: String(page),
                  });
              }}
            >
              <label htmlFor="med-code">Mã toa thuốc</label>
              <input
                id="med-code"
                required
                value={draft}
                placeholder="Dán mã toa từ lịch khám"
                onChange={(e) => setDraft(e.target.value)}
              />
              <button className="button button-secondary" type="submit">
                Xem trạng thái
                <ArrowRight size={14} />
              </button>
            </form>
          </details>
        </aside>
        <div className="med-main">
          {id ? (
            <>
              <header className="med-selected-heading">
                <div>
                  <span className="med-section-label">THÔNG TIN ĐƠN THUỐC</span>
                  <h2>Toa #{id.slice(0, 8).toUpperCase()}</h2>
                  <p>
                    {selected && profile
                      ? profile.fullName
                      : 'Toa thuốc từ liên kết tra cứu'}
                  </p>
                </div>
                <span className="med-readonly">
                  <ShieldCheck size={14} />
                  Chỉ xem
                </span>
              </header>
              <MedicationStatus key={id} api={api} id={id} />
              {selected ? (
                <section className="med-panel med-prescription-content">
                  <SignedPrescription prescription={selected} />
                </section>
              ) : (
                <section className="med-panel med-detail-hint">
                  <FileText size={20} />
                  <div>
                    <h3>Xem nội dung và lời dặn trong toa đã ký</h3>
                    <p>
                      Chọn đúng hồ sơ ở bên trái hoặc mở toa đã ký để xem tên
                      thuốc, liều dùng và hướng dẫn của bác sĩ.
                    </p>
                  </div>
                </section>
              )}
            </>
          ) : (
            <section className="med-empty-state">
              <div className="med-empty-illustration">
                <span className="med-empty-circle" />
                <div className="med-empty-paper">
                  <span className="med-paper-cross">+</span>
                  <span />
                  <span />
                  <span />
                  <Pill size={31} />
                </div>
              </div>
              <span className="med-section-label">THEO DÕI ĐƠN THUỐC</span>
              <h2>Chọn toa thuốc để xem chi tiết</h2>
              <p>
                Danh sách bên trái gồm các toa đã ký của người khám.
                <br />
                Chọn một toa để theo dõi quá trình chuẩn bị và cấp thuốc.
              </p>
              <div className="med-empty-steps">
                <span>
                  <FileText size={17} />
                  Toa đã ký
                </span>
                <ChevronRight size={15} />
                <span>
                  <Pill size={17} />
                  Chuẩn bị thuốc
                </span>
                <ChevronRight size={15} />
                <span>
                  <CheckCircle2 size={17} />
                  Nhận thuốc
                </span>
              </div>
            </section>
          )}
          <aside className="med-advice">
            <span className="med-advice-icon">
              <ShieldCheck size={20} />
            </span>
            <div>
              <h3>Sử dụng thuốc an toàn</h3>
              <p>
                Uống thuốc đúng liều và thời gian được kê. Nếu có thắc mắc về
                cách dùng, hãy hỏi bác sĩ hoặc dược sĩ trước khi sử dụng.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

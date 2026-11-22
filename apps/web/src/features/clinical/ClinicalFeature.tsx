import React, { useEffect, useRef, useState } from 'react';
import { ApiError, errorMessage } from './api';
import type {
  ClinicalApi,
  ClinicalSession,
  DraftInput,
  StartInput,
  StartResult,
  VisitDetail,
  Worklist,
} from './types';
import './clinical.css';
import { TreatmentPanel } from './TreatmentPanel';
import {
  ArrowRight,
  ClipboardList,
  RefreshCw,
  Stethoscope,
} from 'lucide-react';
import {
  Empty,
  Loading,
  Notice,
  shortId,
  timeLabel,
  ConfirmDialog,
} from './ClinicalUI';
import { DraftEditor } from './DraftEditor';
import { MedicalHistory } from './MedicalHistory';
import { PublishedLabResults } from '../diagnostic/PublishedLabResults';
import type { DiagnosticApi } from '../diagnostic/types';
import type { PatientSummary } from './types';

export type ClinicalFeatureProps = {
  api: ClinicalApi;
  session?: ClinicalSession;
  selectedTicket?: StartInput;
  initialView?: 'exam' | 'treatment';
  initialVisitId?: string;
  diagnosticApi?: DiagnosticApi;
  patients?: Record<string, PatientSummary>;
  onNavigate?: (view: 'exam' | 'treatment', visitId: string) => void;
};
const labels: Record<string, string> = {
  IN_PROGRESS: 'Đang khám',
  LAB_REQUEST_PENDING: 'Đang tạo chỉ định',
  WAITING_LAB: 'Chờ xét nghiệm',
  RETURN_READY: 'Sẵn sàng quay lại',
  WAITING_RETURN: 'Chờ quay lại',
  SIGNED: 'Đã ký',
};

function visitUnavailable(error: unknown) {
  return error instanceof ApiError && [401, 403, 404].includes(error.status);
}

export function ClinicalFeature({
  api,
  session,
  selectedTicket,
  initialView,
  initialVisitId,
  diagnosticApi,
  patients,
  onNavigate,
}: ClinicalFeatureProps) {
  if (!session || session.actorType !== 'DOCTOR')
    return (
      <section className="clinical-feature">
        <h1>Bàn khám</h1>
        <p role="alert">Màn hình này chỉ dành cho bác sĩ đã đăng nhập.</p>
      </section>
    );
  return (
    <Workbench
      key={session.userId}
      api={api}
      selectedTicket={selectedTicket}
      initialView={initialView}
      initialVisitId={initialVisitId}
      diagnosticApi={diagnosticApi}
      patients={patients}
      onNavigate={onNavigate}
    />
  );
}
function Workbench({
  api,
  selectedTicket,
  initialView = 'exam',
  initialVisitId = '',
  diagnosticApi,
  patients,
  onNavigate,
}: Omit<ClinicalFeatureProps, 'session'>) {
  const [view, setView] = useState(initialView);
  const [tab, setTab] = useState<'exam' | 'history' | 'results'>('exam');
  const [dirty, setDirty] = useState(false);
  const [draftPending, setDraftPending] = useState(false);
  const [nextVisit, setNextVisit] = useState('');
  const apiRef = useRef(api);
  apiRef.current = api;
  const [date, setDate] = useState('');
  const [state, setState] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [list, setList] = useState<Worklist>({
    items: [],
    total: 0,
    startRequest: null,
  });
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<unknown>();
  const [selected, setSelected] = useState(initialVisitId);
  const [detail, setDetail] = useState<VisitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<unknown>();
  const [detailReload, setDetailReload] = useState(0);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<unknown>();
  const [operation, setOperation] = useState<StartResult | null>(null);
  const [pollReload, setPollReload] = useState(0);
  const intent = useRef<{ input: StartInput; key: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setListError(undefined);
    apiRef.current
      .worklist({ date, state, page, limit: 20 }, controller.signal)
      .then((data) => {
        if (active) {
          setList(data);
          setSelected(
            (current) =>
              current ||
              (initialView === 'exam' ? data.items[0]?.id : '') ||
              '',
          );
        }
      })
      .catch((error) => {
        if (active) setListError(error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [date, state, page, reload]);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setDetail((current) => (current?.visit.id === selected ? current : null));
    setDetailLoading(true);
    setDetailError(undefined);
    apiRef.current
      .detail(selected, controller.signal)
      .then((data) => {
        if (active) setDetail(data);
      })
      .catch((error) => {
        if (!active) return;
        setDetailError(error);
        if (visitUnavailable(error)) setDetail(null);
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [selected, detailReload]);
  const hasPendingLab =
    detail?.labRequests.some((request) =>
      ['PENDING', 'CREATED'].includes(request.state),
    ) ?? false;
  useEffect(() => {
    if (!selected || !hasPendingLab || detailLoading) return;
    const controller = new AbortController();
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await apiRef.current.detail(selected, controller.signal);
        if (active) {
          setDetail(next);
          setDetailError(undefined);
        }
      } catch (error) {
        if (!active) return;
        setDetailError(error);
        if (visitUnavailable(error)) {
          setDetail(null);
          active = false;
        }
      } finally {
        if (active) timer = setTimeout(poll, 2000);
      }
    };
    timer = setTimeout(poll, 2000);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [selected, hasPendingLab, detailLoading, detailReload]);
  useEffect(() => {
    if (!operation?.operationId || operation.state !== 'PENDING') return;
    const controller = new AbortController();
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const id = operation.operationId;
    const poll = async () => {
      try {
        const data = await apiRef.current.worklist(
          { operationId: id },
          controller.signal,
        );
        if (!active) return;
        const result = data.startRequest;
        if (!result || result.operationId !== id)
          throw new ApiError(
            502,
            'INVALID_RESPONSE',
            'Chưa đọc được trạng thái nhận lượt',
          );
        setStartError(undefined);
        if (result.state === 'PENDING') {
          timer = setTimeout(poll, 1000);
          return;
        }
        if (result.state === 'ACCEPTED' && !result.visitId)
          throw new ApiError(
            502,
            'INVALID_RESPONSE',
            'Lượt khám chưa có mã hợp lệ',
          );
        setOperation(result);
        intent.current = null;
        if (result.state === 'ACCEPTED' && result.visitId) {
          setSelected(result.visitId);
          setDetailReload((n) => n + 1);
          setReload((n) => n + 1);
        }
      } catch (error) {
        if (!active) return;
        setStartError(error);
        if (
          !(error instanceof ApiError) ||
          ![401, 403, 404].includes(error.status)
        )
          timer = setTimeout(poll, 2000);
      }
    };
    void poll();
    return () => {
      active = false;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [operation?.operationId, operation?.state, pollReload]);
  async function start() {
    if (starting || operation?.state === 'PENDING') return;
    if (!intent.current && selectedTicket)
      intent.current = {
        input: { ...selectedTicket },
        key: crypto.randomUUID(),
      };
    if (!intent.current) return;
    setStarting(true);
    setStartError(undefined);
    try {
      const result = await apiRef.current.start(
        intent.current.input,
        intent.current.key,
      );
      if (alive.current) setOperation(result);
    } catch (error) {
      if (alive.current) {
        // These responses definitively rejected the request before 202. A
        // corrected queue selection starts a new intention; ambiguous failures
        // preserve the original body/key so a committed start can be replayed.
        if (
          error instanceof ApiError &&
          [400, 401, 403, 404, 409, 422].includes(error.status)
        ) {
          intent.current = null;
        }
        setStartError(error);
      }
    } finally {
      if (alive.current) setStarting(false);
    }
  }
  const patient = detail ? patients?.[detail.visit.patientId] : undefined;
  function changeView(next: 'exam' | 'treatment') {
    if (onNavigate) onNavigate(next, selected);
    else setView(next);
  }
  const choose = (id: string) => {
    if (dirty && id !== selected) setNextVisit(id);
    else {
      setSelected(id);
      onNavigate?.(view, id);
    }
  };
  return (
    <section className="clinical-feature huy-workspace">
      <header className="huy-page-heading">
        <div>
          <p className="huy-eyebrow">KHÔNG GIAN LÀM VIỆC</p>
          <h1>
            {view === 'exam' ? 'Bàn khám bác sĩ' : 'Chỉ định & kê đơn thuốc'}
          </h1>
          <p>
            {view === 'exam'
              ? 'Theo dõi lượt khám và thông tin điều trị.'
              : 'Hoàn thiện chỉ định, đơn thuốc và kết luận điều trị.'}
          </p>
        </div>
        <button
          className="huy-button secondary"
          type="button"
          onClick={() => setReload((n) => n + 1)}
        >
          <RefreshCw size={16} aria-hidden="true" />
          Làm mới
        </button>
      </header>
      <div className="huy-view-switch" aria-label="Không gian bác sĩ">
        <button
          type="button"
          aria-pressed={view === 'exam'}
          disabled={view !== 'exam' && dirty}
          onClick={() => changeView('exam')}
        >
          <Stethoscope size={17} aria-hidden="true" />
          Bàn khám bác sĩ
        </button>
        <button
          type="button"
          aria-pressed={view === 'treatment'}
          disabled={!detail || dirty}
          onClick={() => changeView('treatment')}
        >
          <ClipboardList size={17} aria-hidden="true" />
          Chỉ định & kê đơn
        </button>
      </div>
      {startError !== undefined && (
        <Notice tone="error">
          {errorMessage(startError)}
          {operation?.state === 'PENDING' && (
            <button type="button" onClick={() => setPollReload((n) => n + 1)}>
              Kiểm tra lại trạng thái
            </button>
          )}
        </Notice>
      )}
      {operation?.state === 'PENDING' && (
        <Notice>
          Đang tiếp nhận lượt khám. Chờ hàng chờ xác nhận trước khi mở bệnh án.
        </Notice>
      )}
      {operation?.state === 'REJECTED' && (
        <Notice tone="error">
          Không nhận được lượt.{' '}
          {operation.reasonCode ?? 'Vui lòng chọn lại vé.'}
        </Notice>
      )}
      {detailError !== undefined && detail !== null && (
        <Notice tone="error">
          {errorMessage(detailError)} Đang giữ bản xác nhận gần nhất và nội dung
          chưa lưu.
          <button type="button" onClick={() => setDetailReload((n) => n + 1)}>
            Tải lại lượt khám
          </button>
        </Notice>
      )}
      <div
        className={
          view === 'exam' || !selected
            ? 'huy-doctor-grid'
            : 'huy-treatment-workspace'
        }
      >
        {(view === 'exam' || !selected) && (
          <aside
            className={
              'huy-paper huy-queue' + (!list.items.length ? ' is-empty' : '')
            }
          >
            <div className="huy-section-title">
              <h2>Lượt khám được phân công</h2>
              <span className="huy-count">{list.total}</span>
            </div>
            <div className="huy-filter-pair">
              <label>
                Ngày khám (UTC)
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <label>
                Trạng thái
                <select
                  value={state}
                  onChange={(e) => {
                    setState(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Tất cả</option>
                  {Object.entries(labels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {loading ? (
              <Loading />
            ) : listError ? (
              <Notice tone="error">{errorMessage(listError)}</Notice>
            ) : !list.items.length ? (
              <Empty>
                Chưa có lượt khám được phân công phù hợp với bộ lọc. Lượt khám
                sẽ xuất hiện sau khi nhận vé do tiếp nhận chuyển sang.
              </Empty>
            ) : (
              <ul className="huy-queue-list">
                {list.items.map((v, i) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      className={selected === v.id ? 'selected' : ''}
                      aria-pressed={selected === v.id}
                      disabled={draftPending}
                      aria-label={
                        'Mở lượt ' + (patients?.[v.patientId]?.fullName || v.id)
                      }
                      onClick={() => choose(v.id)}
                    >
                      <span className="huy-queue-number">
                        {String((page - 1) * 20 + i + 1).padStart(2, '0')}
                      </span>
                      <span>
                        <strong>
                          {patients?.[v.patientId]?.fullName ||
                            'Hồ sơ ' + shortId(v.patientId)}
                        </strong>
                        <small>
                          {v.returnRound
                            ? 'Quay lại sau xét nghiệm'
                            : 'Khám lần đầu'}
                        </small>
                        <span
                          className={
                            'huy-badge ' +
                            (v.state === 'SIGNED' ? 'success' : 'info')
                          }
                        >
                          {labels[v.state]}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <nav className="huy-pagination" aria-label="Phân trang">
              <button
                type="button"
                disabled={loading || page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Trước
              </button>
              <span>Trang {page}</span>
              <button
                type="button"
                disabled={loading || page * 20 >= list.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Sau
              </button>
            </nav>
            <div className="huy-queue-bottom">
              <p>
                {selectedTicket
                  ? 'Vé đã được chọn từ tiếp nhận.'
                  : 'Chưa có vé được chuyển sang. Nhân viên tiếp nhận cần gửi đúng vé khám cho bác sĩ.'}
              </p>
              <button
                className="huy-button"
                type="button"
                disabled={
                  starting ||
                  operation?.state === 'PENDING' ||
                  (!selectedTicket && !intent.current)
                }
                onClick={() => void start()}
              >
                {starting
                  ? 'Đang gửi…'
                  : intent.current && startError && !operation
                    ? 'Thử lại yêu cầu nhận lượt'
                    : 'Nhận lượt khám'}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </aside>
        )}
        <div className="huy-visit-workspace">
          {detailLoading && !detail ? (
            <div className="huy-paper">
              <Loading>Đang tải lượt khám…</Loading>
            </div>
          ) : detailError && !detail ? (
            <Notice tone="error">
              {errorMessage(detailError)}
              <button
                type="button"
                onClick={() => setDetailReload((n) => n + 1)}
              >
                Tải lại lượt khám
              </button>
            </Notice>
          ) : detail ? (
            <>
              <section
                className={
                  'huy-paper huy-patient-summary ' +
                  (view === 'exam' ? 'exam' : '')
                }
              >
                <div>
                  <h2>
                    {patient?.fullName ||
                      'Hồ sơ ' + shortId(detail.visit.patientId)}
                  </h2>
                  <p>
                    {patient?.sex && (
                      <>
                        {patient.sex === 'MALE'
                          ? 'Nam'
                          : patient.sex === 'FEMALE'
                            ? 'Nữ'
                            : patient.sex}{' '}
                        ·{' '}
                      </>
                    )}
                    {patient?.birthDate && (
                      <>
                        {new Date(patient.birthDate).toLocaleDateString(
                          'vi-VN',
                        )}{' '}
                        ·{' '}
                      </>
                    )}
                    Lượt {shortId(detail.visit.id)} ·{' '}
                    {detail.visit.returnRound
                      ? 'Quay lại sau xét nghiệm'
                      : 'Khám lần đầu'}
                  </p>
                </div>
                <span
                  className={
                    'huy-badge ' +
                    (detail.visit.state === 'SIGNED' ? 'success' : 'info')
                  }
                >
                  {labels[detail.visit.state]}
                </span>
                {patient?.allergies && (
                  <span className="huy-badge danger">
                    Dị ứng {patient.allergies}
                  </span>
                )}
              </section>
              {view === 'exam' ? (
                <section className="huy-paper huy-exam-panel">
                  <div className="huy-visit-facts">
                    <div>
                      <small>Bắt đầu khám</small>
                      <strong>{timeLabel(detail.visit.startedAt)}</strong>
                    </div>
                    <div>
                      <small>Lượt khám</small>
                      <strong>
                        {detail.visit.returnRound ? 'Quay lại' : 'Lần đầu'}
                      </strong>
                    </div>
                    <div>
                      <small>Bệnh án</small>
                      <strong>
                        {detail.visit.state === 'SIGNED'
                          ? 'Đã ký'
                          : 'Đang cập nhật'}
                      </strong>
                    </div>
                  </div>
                  <div
                    className="huy-tabs"
                    role="tablist"
                    aria-label="Thông tin khám"
                  >
                    {(
                      [
                        ['exam', 'Khám lâm sàng'],
                        ['history', 'Lịch sử khám'],
                        ['results', 'Kết quả xét nghiệm'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        type="button"
                        key={id}
                        role="tab"
                        id={'tab-' + id}
                        aria-selected={tab === id}
                        aria-controls={'panel-' + id}
                        onClick={() => setTab(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div
                    id="panel-exam"
                    role="tabpanel"
                    aria-labelledby="tab-exam"
                    hidden={tab !== 'exam'}
                  >
                    <DraftEditor
                      key={detail.visit.id}
                      api={api}
                      detail={detail}
                      onDirty={setDirty}
                      onPending={setDraftPending}
                      onContinue={() => changeView('treatment')}
                      onReload={() => setDetailReload((n) => n + 1)}
                      onSaved={() => {
                        setReload((n) => n + 1);
                        setDetailReload((n) => n + 1);
                      }}
                    />
                  </div>
                  {tab === 'history' && (
                    <div
                      id="panel-history"
                      role="tabpanel"
                      aria-labelledby="tab-history"
                    >
                      <MedicalHistory
                        api={api}
                        patientId={detail.visit.patientId}
                      />
                    </div>
                  )}
                  {tab === 'results' && (
                    <div
                      id="panel-results"
                      role="tabpanel"
                      aria-labelledby="tab-results"
                    >
                      {diagnosticApi ? (
                        <PublishedLabResults
                          api={diagnosticApi}
                          patientId={detail.visit.patientId}
                        />
                      ) : (
                        <Empty>
                          Kết nối kết quả xét nghiệm chưa được cung cấp.
                        </Empty>
                      )}
                    </div>
                  )}
                </section>
              ) : api.treatment ? (
                <TreatmentPanel
                  key={detail.visit.id}
                  api={api.treatment}
                  diagnosticApi={diagnosticApi}
                  detail={detail}
                  onDirty={setDirty}
                  onChanged={() => {
                    setDetailReload((n) => n + 1);
                    setReload((n) => n + 1);
                  }}
                />
              ) : (
                <Empty>Kết nối chỉ định và kê đơn chưa sẵn sàng.</Empty>
              )}
            </>
          ) : (
            <section className="huy-paper huy-route-empty">
              <h2>
                {view === 'treatment'
                  ? 'Chọn lượt khám để chỉ định và kê đơn'
                  : 'Bắt đầu từ lượt khám được phân công'}
              </h2>
              <p>
                Chọn một lượt khám trong danh sách bên trái để xem thông tin
                đúng người bệnh.
              </p>
              <ol>
                <li>Nhận vé khám do nhân viên tiếp nhận chuyển sang.</li>
                <li>Mở lượt khám, ghi nhận triệu chứng và lưu bệnh án.</li>
                <li>
                  Chuyển sang chỉ định xét nghiệm hoặc kê đơn cho lượt đang mở.
                </li>
              </ol>
              {view === 'treatment' && (
                <button
                  type="button"
                  className="huy-button secondary"
                  onClick={() => changeView('exam')}
                >
                  Về bàn khám để chọn lượt
                </button>
              )}
            </section>
          )}
        </div>
      </div>
      {nextVisit && (
        <ConfirmDialog
          title="Chuyển lượt khám?"
          onClose={() => setNextVisit('')}
          onConfirm={() => {
            setDirty(false);
            setSelected(nextVisit);
            onNavigate?.(view, nextVisit);
            setNextVisit('');
          }}
        >
          <p>
            Nội dung khám chưa lưu sẽ được bỏ. Bạn có thể quay lại để lưu trước
            khi chuyển.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

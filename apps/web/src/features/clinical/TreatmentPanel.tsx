import { useEffect, useState } from 'react';
import { Check, FileCheck2, Plus, Search, Send, Trash2 } from 'lucide-react';
import { errorMessage } from './api';
import type {
  ClinicalTreatmentApi,
  VisitDetail,
  PrescriptionLine,
  TreatmentCatalogMedicine,
  TreatmentCatalogTest,
  LabRequest,
  Prescription,
} from './types';
import type { DiagnosticApi } from '../diagnostic/types';
import { useMutation } from './useMutation';
import { ConfirmDialog, Empty, Loading, Notice, shortId } from './ClinicalUI';
import { CancelLabDialog } from '../diagnostic/CancelLabDialog';
import { LeaveGuard } from './LeaveGuard';

const labLabels: Record<string, string> = {
  PENDING: 'Đang tạo chỉ định',
  CREATED: 'Chờ kết quả',
  REJECTED: 'Chỉ định bị từ chối',
  PUBLISHED: 'Đã công bố',
  CANCELLED: 'Đã hủy',
  SUPERSEDED: 'Đã thay thế',
};
const terminal = (state: string) =>
  ['PUBLISHED', 'CANCELLED', 'SUPERSEDED'].includes(state);

export function TreatmentPanel({
  api,
  diagnosticApi,
  detail,
  onChanged,
  onDirty,
}: {
  api: ClinicalTreatmentApi;
  diagnosticApi?: DiagnosticApi;
  detail: VisitDetail;
  onChanged: () => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const [medicines, setMedicines] = useState<TreatmentCatalogMedicine[]>([]);
  const [tests, setTests] = useState<TreatmentCatalogTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<unknown>();
  const [reload, setReload] = useState(0);
  const [medicineSearch, setMedicineSearch] = useState('');
  const [labSearch, setLabSearch] = useState('');
  const [selectedTests, setSelectedTests] = useState<string[]>([]);
  const initial = detail.prescriptions
    .filter((p) => p.state !== 'DELETED')
    .at(-1);
  const [rxId, setRxId] = useState(initial?.id ?? '');
  const remoteRx = detail.prescriptions.find((p) => p.id === rxId);
  const [acknowledgedRx, setAcknowledgedRx] = useState<Prescription>();
  const rx =
    acknowledgedRx?.id === rxId &&
    (!remoteRx || acknowledgedRx.version > remoteRx.version)
      ? acknowledgedRx
      : remoteRx;
  const [lines, setLines] = useState<PrescriptionLine[]>(
    initial?.lines.map((line) => ({ ...line })) ?? [],
  );
  const [dirty, setDirty] = useState(false);
  const [queuedRequest, setQueuedRequest] = useState('');
  const [replacement, setReplacement] = useState<LabRequest | null>(null);
  const [cancelOrder, setCancelOrder] = useState('');
  const [confirmation, setConfirmation] = useState<{
    kind: 'complete' | 'finalize' | 'delete';
    visitVersion: number;
    rxId: string;
    rxVersion: number;
  } | null>(null);
  const mutation = useMutation();
  const [acknowledgedSigned, setAcknowledgedSigned] = useState(false);
  const unfinished =
    dirty || selectedTests.length > 0 || mutation.busy || mutation.uncertain;
  useEffect(() => {
    onDirty?.(unfinished);
  }, [unfinished, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  const signed = detail.visit.state === 'SIGNED' || acknowledgedSigned;
  const labAllowed =
    !signed &&
    ['IN_PROGRESS', 'LAB_REQUEST_PENDING', 'WAITING_LAB'].includes(
      detail.visit.state,
    );
  const returning = ['RETURN_READY', 'WAITING_RETURN'].includes(
    detail.visit.state,
  );
  const anotherFinal = detail.prescriptions.some(
    (p) => p.state === 'FINAL' && p.id !== rxId,
  );
  const finalized = rx?.state === 'FINAL';
  const waitingForRegistry =
    !!queuedRequest &&
    !detail.labRequests.some((r) => r.requestId === queuedRequest);
  const unresolved =
    waitingForRegistry || detail.labRequests.some((r) => !terminal(r.state));
  const canSign =
    !signed &&
    !unresolved &&
    !selectedTests.length &&
    !dirty &&
    !!detail.notes.at(-1)?.diagnosis.trim() &&
    detail.visit.state === 'IN_PROGRESS';
  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    setLoading(true);
    setCatalogError(undefined);
    Promise.all([api.medicines(abort.signal), api.labTests(abort.signal)])
      .then(([m, t]) => {
        if (active) {
          setMedicines(m.filter((x) => x.status === 'ACTIVE'));
          setTests(t.filter((x) => x.status === 'ACTIVE'));
        }
      })
      .catch((e) => {
        if (active) setCatalogError(e);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [api, reload]);
  useEffect(() => {
    if (!dirty && rx) setLines(rx.lines.map((line) => ({ ...line })));
  }, [rx?.id, rx?.version, dirty]);
  const availableMedicines = medicines.filter(
    (m) =>
      (m.name + ' ' + m.code)
        .toLocaleLowerCase('vi-VN')
        .includes(medicineSearch.toLocaleLowerCase('vi-VN')) &&
      !lines.some((l) => l.medicineCode === m.code),
  );
  function updateLine(index: number, patch: Partial<PrescriptionLine>) {
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
    setDirty(true);
  }
  function savePrescription() {
    const body = { lines: lines.map((line) => ({ ...line })) };
    const saved = (result: {
      prescription: import('./types').Prescription;
    }) => {
      setRxId(result.prescription.id);
      setAcknowledgedRx(result.prescription);
      setLines(result.prescription.lines);
      setDirty(false);
      onChanged();
    };
    if (rx)
      mutation.perform(
        (key) =>
          api.updatePrescription(
            rx.id,
            { ...body, expectedVersion: rx.version },
            key,
          ),
        saved,
        'Đã lưu thay đổi toa nháp.',
      );
    else
      mutation.perform(
        (key) => api.createPrescription(detail.visit.id, body, key),
        saved,
        'Đã lưu toa nháp.',
      );
  }
  function requestLab() {
    const body = {
      tests: tests
        .filter((t) => selectedTests.includes(t.id))
        .map((t) => ({ testId: t.id, revision: t.revision })),
      ...(replacement
        ? {
            replacesRequestId: replacement.requestId,
            expectedSourceVersion: replacement.sourceVersion,
          }
        : {}),
    };
    mutation.perform(
      (key) => api.requestLab(detail.visit.id, body, key),
      (result) => {
        setQueuedRequest(result.requestId);
        setSelectedTests([]);
        setReplacement(null);
        onChanged();
      },
      'Đã tiếp nhận yêu cầu chỉ định. Đang chờ xác nhận tạo xét nghiệm.',
    );
  }
  function confirm() {
    const action = confirmation;
    if (!action) return;
    setConfirmation(null);
    if (action.kind === 'complete')
      mutation.perform(
        (key) =>
          api.complete(
            detail.visit.id,
            { expectedVersion: action.visitVersion },
            key,
          ),
        () => {
          setAcknowledgedSigned(true);
          onChanged();
        },
        'Đã ký kết luận khám.',
      );
    if (action.kind === 'finalize')
      mutation.perform(
        (key) =>
          api.finalizePrescription(
            action.rxId,
            { expectedVersion: action.rxVersion },
            key,
          ),
        (result) => {
          setAcknowledgedRx(result.prescription);
          setDirty(false);
          onChanged();
        },
        'Đã ký toa thuốc. Hệ thống đang gửi thông tin tới nhà thuốc.',
      );
    if (action.kind === 'delete')
      mutation.perform(
        (key) => api.deletePrescription(action.rxId, action.rxVersion, key),
        () => {
          setRxId('');
          setLines([]);
          setDirty(false);
          onChanged();
        },
        'Đã xóa toa nháp.',
      );
  }
  function ask(kind: 'complete' | 'finalize' | 'delete') {
    setConfirmation({
      kind,
      visitVersion: detail.visit.version,
      rxId: rx?.id ?? '',
      rxVersion: rx?.version ?? 0,
    });
  }
  const signingMessage = signed
    ? 'Kết luận khám đã ký'
    : returning
      ? 'Cần nhận vé khám quay lại từ tiếp nhận trước khi ký kết luận'
      : selectedTests.length
        ? 'Có chỉ định chưa gửi'
        : unresolved
          ? 'Chờ kết quả xét nghiệm'
          : dirty
            ? 'Toa có thay đổi chưa lưu'
            : canSign
              ? 'Đủ điều kiện ký kết luận'
              : 'Cần hoàn thiện bệnh án trước khi ký';
  return (
    <div className="huy-treatment">
      <LeaveGuard
        active={unfinished}
        pending={mutation.busy || mutation.uncertain}
      />
      <div className="huy-treatment-feedback">
        {mutation.notice && <Notice tone="success">{mutation.notice}</Notice>}
        {mutation.error !== undefined && (
          <Notice tone="error">
            {errorMessage(mutation.error)}
            {mutation.uncertain && (
              <button
                type="button"
                disabled={mutation.busy}
                onClick={() => void mutation.retry()}
              >
                Thử lại cùng yêu cầu
              </button>
            )}
            {mutation.conflict && (
              <button
                type="button"
                onClick={() => {
                  mutation.resolveConflict();
                  onChanged();
                }}
              >
                Tải lại phiên bản mới, giữ nội dung đang soạn
              </button>
            )}
          </Notice>
        )}
        {catalogError !== undefined && (
          <Notice tone="error">
            Không tải được danh mục.
            <button type="button" onClick={() => setReload((n) => n + 1)}>
              Tải lại danh mục
            </button>
          </Notice>
        )}
      </div>
      <section className="huy-paper huy-lab-prescribe">
        <h2>Chỉ định cận lâm sàng</h2>
        <label>
          Tìm dịch vụ
          <div className="huy-search-field">
            <Search size={18} aria-hidden="true" />
            <input
              value={labSearch}
              disabled={mutation.locked || signed}
              onChange={(e) => setLabSearch(e.target.value)}
              placeholder="Tìm tên / mã xét nghiệm…"
            />
          </div>
        </label>
        {replacement && (
          <Notice tone="warning">
            Đang tạo lại chỉ định {shortId(replacement.requestId)}.
            <button
              type="button"
              disabled={mutation.locked}
              onClick={() => {
                setReplacement(null);
                setSelectedTests([]);
              }}
            >
              Bỏ tạo lại
            </button>
          </Notice>
        )}
        {loading ? (
          <Loading>Đang tải xét nghiệm…</Loading>
        ) : (
          <>
            <p className="huy-muted">Đã chọn {selectedTests.length} dịch vụ</p>
            <fieldset
              className="huy-lab-options"
              disabled={mutation.locked || !labAllowed || waitingForRegistry}
            >
              <legend className="huy-sr-only">Danh mục xét nghiệm</legend>
              {tests
                .filter((t) =>
                  (t.name + ' ' + (t.code ?? ''))
                    .toLocaleLowerCase('vi-VN')
                    .includes(labSearch.toLocaleLowerCase('vi-VN')),
                )
                .map((test) => (
                  <label className="huy-test-choice" key={test.id}>
                    <input
                      type="checkbox"
                      checked={selectedTests.includes(test.id)}
                      onChange={(e) =>
                        setSelectedTests((current) =>
                          e.target.checked
                            ? [...current, test.id]
                            : current.filter((id) => id !== test.id),
                        )
                      }
                    />
                    <span>
                      <strong>{test.name}</strong>
                      <small>{test.code || shortId(test.id)}</small>
                    </span>
                  </label>
                ))}
              {!tests.length && <Empty>Chưa có xét nghiệm khả dụng.</Empty>}
            </fieldset>
          </>
        )}
        {detail.labRequests.length > 0 && (
          <div className="huy-lab-registry">
            <h3>Chỉ định đã gửi</h3>
            {detail.labRequests.map((request) => (
              <div key={request.requestId} className="huy-lab-request">
                <span
                  className={
                    'huy-badge ' +
                    (terminal(request.state)
                      ? 'success'
                      : request.state === 'REJECTED'
                        ? 'danger'
                        : 'warning')
                  }
                >
                  {labLabels[request.state] ?? request.state}
                </span>
                <small>#{shortId(request.requestId)}</small>
                {request.reasonCode && <p>{request.reasonCode}</p>}
                {request.state === 'REJECTED' &&
                  !!request.sourceVersion &&
                  !signed && (
                    <button
                      type="button"
                      disabled={mutation.locked}
                      className="huy-link"
                      onClick={() => {
                        setReplacement(request);
                        setSelectedTests(
                          (request.tests ?? []).map((t) => t.testId),
                        );
                      }}
                    >
                      Tạo lại chỉ định
                    </button>
                  )}
                {request.orderId &&
                  request.state === 'CREATED' &&
                  !signed &&
                  diagnosticApi?.cancel && (
                    <button
                      type="button"
                      disabled={mutation.locked}
                      className="huy-link"
                      onClick={() => setCancelOrder(request.orderId!)}
                    >
                      Kiểm tra điều kiện hủy
                    </button>
                  )}
              </div>
            ))}
          </div>
        )}
        <div className="huy-lab-bottom">
          <p className="huy-muted">
            {signed
              ? 'Kết luận đã ký.'
              : unresolved
                ? 'Chờ công bố kết quả hoặc hủy hợp lệ trước khi ký kết luận.'
                : selectedTests.length
                  ? 'Chưa gửi chỉ định · Khóa ký kết luận'
                  : 'Không còn chỉ định đang chờ.'}
          </p>
          <button
            className="huy-button"
            type="button"
            disabled={
              !labAllowed ||
              mutation.locked ||
              loading ||
              waitingForRegistry ||
              !selectedTests.length
            }
            onClick={requestLab}
          >
            <Send size={16} aria-hidden="true" />
            Gửi chỉ định xét nghiệm
          </button>
        </div>
      </section>
      <section className="huy-paper huy-prescription">
        <div className="huy-section-title">
          <h2>Kê đơn thuốc & xác nhận</h2>
          <span
            className={
              'huy-badge ' +
              (signed
                ? 'success'
                : unresolved || selectedTests.length
                  ? 'warning'
                  : 'info')
            }
          >
            {finalized
              ? 'Toa đã ký'
              : signed
                ? 'Kết luận đã ký'
                : unresolved
                  ? 'Chờ kết quả'
                  : 'Toa nháp'}
          </span>
        </div>
        <p className="huy-muted">{signingMessage}</p>
        <Notice tone="warning">
          Kiểm tra thuốc đang dùng và thông tin dị ứng trước khi ký đơn.
        </Notice>
        {detail.prescriptions.filter((p) => p.state !== 'DELETED').length >
          1 && (
          <label>
            Toa thuốc
            <select
              value={rxId}
              disabled={mutation.locked || dirty}
              onChange={(e) => {
                setRxId(e.target.value);
                setDirty(false);
              }}
            >
              {detail.prescriptions
                .filter((p) => p.state !== 'DELETED')
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    Toa #{shortId(p.id)} ·{' '}
                    {p.state === 'FINAL' ? 'Đã ký' : 'Nháp'} · bản {p.revision}
                  </option>
                ))}
            </select>
          </label>
        )}
        {!signed && !finalized && (
          <div className="huy-medicine-picker">
            <label>
              Danh mục thuốc
              <div className="huy-search-field">
                <Search size={18} aria-hidden="true" />
                <input
                  value={medicineSearch}
                  disabled={mutation.locked}
                  onChange={(e) => setMedicineSearch(e.target.value)}
                  placeholder="Nhập tên hoặc mã thuốc để thêm vào đơn…"
                />
              </div>
            </label>
            {medicineSearch && (
              <ul className="huy-medicine-options">
                {availableMedicines.slice(0, 12).map((m) => (
                  <li key={m.code}>
                    <button
                      type="button"
                      disabled={mutation.locked || lines.length >= 100}
                      onClick={() => {
                        setLines((current) => [
                          ...current,
                          {
                            medicineCode: m.code,
                            nameSnapshot: m.name,
                            doseText: '',
                            quantity: 1,
                            instruction: '',
                          },
                        ]);
                        setDirty(true);
                        setMedicineSearch('');
                      }}
                    >
                      <span>
                        <strong>{m.name}</strong>
                        <small>
                          {m.code}
                          {m.unit ? ' · ' + m.unit : ''}
                        </small>
                      </span>
                      <Plus size={18} aria-hidden="true" />
                    </button>
                  </li>
                ))}
                {!availableMedicines.length && (
                  <li>Không có thuốc phù hợp hoặc thuốc đã có trong đơn.</li>
                )}
              </ul>
            )}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            savePrescription();
          }}
        >
          <div className="huy-table-scroll">
            <table className="huy-table huy-prescription-table">
              <thead>
                <tr>
                  <th>Danh mục thuốc</th>
                  <th>Liều dùng</th>
                  <th>SL</th>
                  {!signed && !finalized && (
                    <th>
                      <span className="huy-sr-only">Thao tác</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.medicineCode}>
                    <td>
                      <strong>{line.nameSnapshot || line.medicineCode}</strong>
                      <small>{line.medicineCode}</small>
                      <label className="huy-line-instruction">
                        <span>Lời dặn</span>
                        <input
                          value={line.instruction ?? ''}
                          maxLength={2000}
                          disabled={signed || finalized || mutation.locked}
                          onChange={(e) =>
                            updateLine(index, { instruction: e.target.value })
                          }
                          placeholder="Hướng dẫn dùng thuốc"
                        />
                      </label>
                    </td>
                    <td>
                      <label>
                        <span className="huy-sr-only">
                          Liều dùng {line.nameSnapshot || line.medicineCode}
                        </span>
                        <input
                          required
                          maxLength={1000}
                          value={line.doseText}
                          disabled={signed || finalized || mutation.locked}
                          onChange={(e) =>
                            updateLine(index, { doseText: e.target.value })
                          }
                          placeholder="Nhập liều dùng"
                        />
                      </label>
                    </td>
                    <td>
                      <label>
                        <span className="huy-sr-only">
                          Số lượng {line.nameSnapshot || line.medicineCode}
                        </span>
                        <input
                          type="number"
                          required
                          min={1}
                          max={2147483647}
                          step={1}
                          value={
                            Number.isNaN(line.quantity) ? '' : line.quantity
                          }
                          disabled={signed || finalized || mutation.locked}
                          onChange={(e) =>
                            updateLine(index, {
                              quantity: e.target.valueAsNumber,
                            })
                          }
                        />
                      </label>
                    </td>
                    {!signed && !finalized && (
                      <td>
                        <button
                          className="huy-icon-button danger"
                          type="button"
                          disabled={mutation.locked}
                          aria-label={
                            'Bỏ thuốc ' +
                            (line.nameSnapshot || line.medicineCode)
                          }
                          onClick={() => {
                            setLines((current) =>
                              current.filter((_, i) => i !== index),
                            );
                            setDirty(true);
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!lines.length && (
            <Empty>
              {signed
                ? 'Lượt khám chưa có toa thuốc.'
                : 'Tìm thuốc trong danh mục để bắt đầu soạn toa.'}
            </Empty>
          )}
          {finalized && (
            <Notice tone="success">
              <Check size={16} aria-hidden="true" /> Toa đã ký, chỉ đọc. Bạn có
              thể xem trạng thái cấp phát tại nhà thuốc.
            </Notice>
          )}
          <div className="huy-prescription-actions">
            <button
              className="huy-button teal"
              type="button"
              disabled={mutation.locked || !canSign}
              onClick={() => ask('complete')}
            >
              <FileCheck2 size={16} aria-hidden="true" />
              {signed ? 'Kết luận đã ký' : 'Ký kết luận khám'}
            </button>
            {!signed && !finalized && (
              <button
                className="huy-button secondary"
                type="submit"
                disabled={
                  mutation.locked ||
                  loading ||
                  !lines.length ||
                  lines.some(
                    (line) =>
                      !line.doseText.trim() ||
                      !Number.isInteger(line.quantity) ||
                      line.quantity < 1,
                  )
                }
              >
                Lưu toa nháp
              </button>
            )}
            <button
              className="huy-button"
              type="button"
              disabled={
                mutation.locked ||
                !signed ||
                finalized ||
                !rx ||
                anotherFinal ||
                !lines.length ||
                dirty
              }
              onClick={() => ask('finalize')}
            >
              {finalized ? 'Toa đã ký' : 'Ký toa thuốc'}
            </button>
          </div>
          {rx?.state === 'DRAFT' && !signed && (
            <button
              className="huy-link danger"
              type="button"
              disabled={mutation.locked}
              onClick={() => ask('delete')}
            >
              Xóa toa nháp này
            </button>
          )}
        </form>
      </section>
      {confirmation && (
        <ConfirmDialog
          title={
            confirmation.kind === 'complete'
              ? 'Ký kết luận khám?'
              : confirmation.kind === 'finalize'
                ? 'Ký toa thuốc?'
                : 'Xóa toa nháp?'
          }
          confirmLabel={
            confirmation.kind === 'delete' ? 'Xóa toa nháp' : 'Xác nhận ký'
          }
          onClose={() => setConfirmation(null)}
          onConfirm={confirm}
        >
          <p>
            {confirmation.kind === 'complete'
              ? 'Kết luận đã ký sẽ chuyển sang chế độ chỉ đọc. Toa đã chuẩn bị được ký ở bước tiếp theo.'
              : confirmation.kind === 'finalize'
                ? 'Toa đã ký sẽ chuyển tới nhà thuốc và giữ nguyên nội dung.'
                : 'Toa nháp này sẽ bị xóa khỏi lượt khám.'}
          </p>
        </ConfirmDialog>
      )}
      {cancelOrder && diagnosticApi && (
        <CancelLabDialog
          api={diagnosticApi}
          orderId={cancelOrder}
          onClose={() => setCancelOrder('')}
          onCancelled={() => {
            setCancelOrder('');
            onChanged();
          }}
        />
      )}
    </div>
  );
}

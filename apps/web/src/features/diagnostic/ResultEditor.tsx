import { useEffect, useState } from 'react';
import { CheckCircle2, FileCheck2, Save, Send } from 'lucide-react';
import type {
  DiagnosticApi,
  DiagnosticOrder,
  DiagnosticSession,
  LabResult,
  ResultItemInput,
} from './types';
import {
  ConfirmDialog,
  Empty,
  Notice,
  shortId,
  timeLabel,
} from '../clinical/ClinicalUI';
import { useMutation } from '../clinical/useMutation';
import { diagnosticMessage } from './api';
import { ResultTable } from './PublishedLabResults';
import { LeaveGuard } from '../clinical/LeaveGuard';

const resultLabels: Record<string, string> = {
  DRAFT: 'Kết quả nháp',
  REVIEW: 'Chờ duyệt',
  REWORK: 'Cần làm lại',
  PUBLISHED: 'Đã công bố',
};
export function ResultEditor({
  api,
  order,
  result,
  session,
  onChanged,
  onDirty,
  onPending,
  unavailable,
}: {
  api: DiagnosticApi;
  order: DiagnosticOrder;
  result?: LabResult;
  session: DiagnosticSession;
  onChanged: () => void;
  onDirty: (dirty: boolean) => void;
  onPending?: (pending: boolean) => void;
  unavailable: boolean;
}) {
  const makeItems = (): ResultItemInput[] =>
    order.tests.map((test) => {
      const old = result?.items.find((item) => item.testCode === test.code);
      return {
        testCode: test.code,
        valueText: old?.valueText ?? '',
        flag: old?.flag ?? '',
      };
    });
  const [saved, setSaved] = useState(result);
  const [items, setItems] = useState(makeItems);
  const [dirty, setDirty] = useState(false);
  const [version, setVersion] = useState(result?.version ?? 0);
  const [confirmation, setConfirmation] = useState<{
    action: 'submit-review' | 'return-rework' | 'publish';
    id: string;
    version: number;
  } | null>(null);
  const [reason, setReason] = useState('');
  const [discard, setDiscard] = useState(false);
  const mutation = useMutation();
  useEffect(() => {
    onPending?.(mutation.busy || mutation.uncertain);
  }, [mutation.busy, mutation.uncertain, onPending]);
  useEffect(() => () => onPending?.(false), [onPending]);
  const current = saved ?? result;
  const published = current?.state === 'PUBLISHED';
  const editable =
    session.capabilities.includes('LAB_TECH') &&
    (!current || current.state === 'DRAFT' || current.state === 'REWORK');
  const reviewer = session.capabilities.includes('LAB_REVIEW');
  const ownResult = current?.enteredBy === session.userId;
  const remoteChanged = dirty && !!result && result.version !== version;
  const locked = mutation.locked || unavailable || remoteChanged;
  useEffect(() => {
    onDirty(dirty || mutation.uncertain);
  }, [dirty, mutation.uncertain, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => {
    // A polling response may precede the write response. Never replace a newer
    // acknowledged result with an older projection or an empty result list.
    if (
      !dirty &&
      !mutation.busy &&
      result &&
      (!saved || result.id !== saved.id || result.version >= saved.version)
    ) {
      setSaved(result);
      setItems(makeItems());
      setVersion(result.version);
    }
  }, [result?.id, result?.version, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  function save() {
    const body = { items: items.map((item) => ({ ...item })) };
    const success = (value: { result: LabResult }) => {
      setSaved(value.result);
      setVersion(value.result.version);
      setDirty(false);
      onChanged();
    };
    if (current && api.updateResult)
      mutation.perform(
        (key) =>
          api.updateResult!(
            current.id,
            { ...body, expectedVersion: version },
            key,
          ),
        success,
        'Đã lưu kết quả nháp.',
      );
    else if (api.createResult)
      mutation.perform(
        (key) => api.createResult!(order.id, body, key),
        success,
        'Đã tạo kết quả nháp.',
      );
  }
  function ask(action: 'submit-review' | 'return-rework' | 'publish') {
    if (current)
      setConfirmation({ action, id: current.id, version: current.version });
  }
  function confirm() {
    const action = confirmation;
    if (!action || !api.transitionResult) return;
    const body = {
      expectedVersion: action.version,
      ...(action.action === 'return-rework' ? { reason: reason.trim() } : {}),
    };
    setConfirmation(null);
    mutation.perform(
      (key) => api.transitionResult!(action.id, action.action, body, key),
      (value) => {
        setSaved(value.result);
        setVersion(value.result.version);
        setDirty(false);
        setReason('');
        onChanged();
      },
      action.action === 'publish'
        ? 'Đã duyệt và công bố kết quả.'
        : action.action === 'return-rework'
          ? 'Đã yêu cầu làm lại kết quả.'
          : 'Đã gửi kết quả để duyệt.',
    );
  }
  if (!api.createResult || !api.updateResult || !api.transitionResult)
    return <Empty>Kết nối nhập và duyệt kết quả chưa được cung cấp.</Empty>;
  return (
    <section className="huy-result-editor" aria-label="Nhập và duyệt kết quả">
      <LeaveGuard
        active={dirty || mutation.busy || mutation.uncertain}
        pending={mutation.busy || mutation.uncertain}
      />
      <div className="huy-section-title">
        <h3>
          {current ? resultLabels[current.state] : 'Nhập kết quả xét nghiệm'}
        </h3>
        {current && (
          <span
            className={
              'huy-badge ' +
              (published
                ? 'success'
                : current.state === 'REWORK'
                  ? 'danger'
                  : 'warning')
            }
          >
            {resultLabels[current.state]}
          </span>
        )}
      </div>
      {mutation.notice && <Notice tone="success">{mutation.notice}</Notice>}
      {mutation.error !== undefined && (
        <Notice tone="error">
          {diagnosticMessage(mutation.error)}
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
            <button type="button" onClick={() => setDiscard(true)}>
              Tải lại kết quả đã lưu
            </button>
          )}
        </Notice>
      )}
      {remoteChanged && (
        <Notice tone="warning">
          Kết quả đã có phiên bản mới. Bản nhập của bạn được giữ nguyên.
          <button type="button" onClick={() => setDiscard(true)}>
            Xem lại kết quả đã lưu
          </button>
        </Notice>
      )}
      {current?.state === 'REWORK' && (
        <Notice tone="warning">
          Kết quả cần làm lại. Cập nhật và lưu nháp trước khi gửi duyệt lại.
        </Notice>
      )}
      {current?.state === 'REVIEW' && ownResult && (
        <Notice tone="error">
          Bạn đã nhập kết quả này. Một nhân viên có quyền duyệt khác cần kiểm
          tra và công bố.
        </Notice>
      )}
      {published && (
        <Notice tone="success">
          <CheckCircle2 size={18} aria-hidden="true" />
          Đã công bố lúc {timeLabel(current.publishedAt)}. Kết quả chuyển sang
          chế độ chỉ đọc.
        </Notice>
      )}
      {editable ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="huy-table-scroll">
            <table className="huy-table huy-result-table">
              <thead>
                <tr>
                  <th>Chỉ số</th>
                  <th>Kết quả</th>
                  <th>Tham chiếu</th>
                  <th>Đơn vị</th>
                  <th>Đánh giá</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const test = order.tests.find(
                    (test) => test.code === item.testCode,
                  );
                  return (
                    <tr key={item.testCode}>
                      <td>
                        <strong>{test?.name || item.testCode}</strong>
                        <small>{item.testCode}</small>
                      </td>
                      <td>
                        <label>
                          <span className="huy-sr-only">
                            Kết quả {test?.name || item.testCode}
                          </span>
                          <input
                            required
                            maxLength={2000}
                            value={item.valueText}
                            disabled={locked}
                            onChange={(e) => {
                              setItems((values) =>
                                values.map((value, i) =>
                                  i === index
                                    ? { ...value, valueText: e.target.value }
                                    : value,
                                ),
                              );
                              setDirty(true);
                            }}
                            placeholder="Nhập kết quả"
                          />
                        </label>
                      </td>
                      <td>{test?.referenceRange || '—'}</td>
                      <td>{test?.unit || '—'}</td>
                      <td>
                        <label>
                          <span className="huy-sr-only">
                            Đánh giá {item.testCode}
                          </span>
                          <select
                            value={item.flag}
                            disabled={locked}
                            onChange={(e) => {
                              setItems((values) =>
                                values.map((value, i) =>
                                  i === index
                                    ? { ...value, flag: e.target.value }
                                    : value,
                                ),
                              );
                              setDirty(true);
                            }}
                          >
                            <option value="">Chưa đánh giá</option>
                            <option value="NORMAL">Bình thường</option>
                            <option value="HIGH">Tăng ↑</option>
                            <option value="LOW">Giảm ↓</option>
                            <option value="ABNORMAL">Bất thường</option>
                          </select>
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!items.length && (
            <Empty>
              Chỉ định chưa có danh sách xét nghiệm để nhập kết quả.
            </Empty>
          )}
          <div className="huy-result-actions">
            <p className="huy-muted">
              {current
                ? 'Người nhập #' +
                  shortId(current.enteredBy) +
                  ' · Phiên bản ' +
                  version
                : 'Kết quả chưa được lưu'}
              {dirty ? ' · Chưa lưu thay đổi' : ''}
            </p>
            <div>
              <button
                type="submit"
                className="huy-button secondary"
                disabled={
                  locked ||
                  !items.length ||
                  items.some((item) => !item.valueText.trim())
                }
              >
                <Save size={16} aria-hidden="true" />
                Lưu kết quả nháp
              </button>
              <button
                type="button"
                className="huy-button"
                disabled={
                  locked ||
                  !current ||
                  dirty ||
                  !items.length ||
                  items.some((item) => !item.valueText.trim())
                }
                onClick={() => ask('submit-review')}
              >
                <Send size={16} aria-hidden="true" />
                Gửi duyệt
              </button>
            </div>
          </div>
        </form>
      ) : current ? (
        <>
          <ResultTable result={current} />
          <p className="huy-muted">
            Người nhập #{shortId(current.enteredBy)} ·{' '}
            {current.state === 'REVIEW'
              ? 'Đang chờ người duyệt độc lập'
              : published
                ? 'Đã công bố'
                : 'Chỉ đọc'}
          </p>
          {reviewer && current.state === 'REVIEW' && (
            <div className="huy-result-actions">
              <button
                className="huy-button secondary"
                type="button"
                disabled={locked || ownResult}
                onClick={() => ask('return-rework')}
              >
                Yêu cầu làm lại
              </button>
              <button
                className="huy-button teal"
                type="button"
                disabled={locked || ownResult}
                onClick={() => ask('publish')}
              >
                <FileCheck2 size={17} aria-hidden="true" />
                Duyệt và công bố
              </button>
            </div>
          )}
        </>
      ) : (
        <Empty>
          Chưa có kết quả nháp. Nhân viên nhập kết quả cần hoàn thiện trước khi
          gửi duyệt.
        </Empty>
      )}
      {confirmation && (
        <ConfirmDialog
          title={
            confirmation.action === 'publish'
              ? 'Duyệt và công bố kết quả?'
              : confirmation.action === 'return-rework'
                ? 'Yêu cầu làm lại kết quả?'
                : 'Gửi kết quả để duyệt?'
          }
          confirmLabel={
            confirmation.action === 'publish'
              ? 'Duyệt và công bố'
              : confirmation.action === 'return-rework'
                ? 'Yêu cầu làm lại'
                : 'Gửi duyệt'
          }
          confirmDisabled={
            confirmation.action === 'return-rework' && !reason.trim()
          }
          onClose={() => setConfirmation(null)}
          onConfirm={confirm}
        >
          {confirmation.action === 'return-rework' ? (
            <label>
              Lý do cần làm lại
              <textarea
                required
                value={reason}
                maxLength={2000}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Nêu rõ nội dung cần kiểm tra hoặc nhập lại…"
              />
            </label>
          ) : (
            <p>
              {confirmation.action === 'publish'
                ? 'Kết quả sau khi công bố có thể được bác sĩ và bệnh nhân được cấp quyền xem. Nội dung sẽ chuyển sang chỉ đọc.'
                : 'Kết quả sẽ được chuyển tới người duyệt độc lập. Bạn có thể sửa lại khi được yêu cầu làm lại.'}
            </p>
          )}
        </ConfirmDialog>
      )}
      {discard && (
        <ConfirmDialog
          title="Tải lại kết quả đã lưu?"
          onClose={() => setDiscard(false)}
          onConfirm={() => {
            setDirty(false);
            setSaved(result);
            setItems(makeItems());
            setVersion(result?.version ?? 0);
            mutation.resolveConflict();
            setDiscard(false);
            onChanged();
          }}
        >
          <p>Nội dung chưa lưu sẽ được thay bằng phiên bản trên máy chủ.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}

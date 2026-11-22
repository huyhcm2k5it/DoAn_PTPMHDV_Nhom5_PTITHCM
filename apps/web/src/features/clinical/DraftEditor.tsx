import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Save } from 'lucide-react';
import type { ClinicalApi, VisitDetail } from './types';
import { errorMessage } from './api';
import { ConfirmDialog, Notice, shortId } from './ClinicalUI';
import { useMutation } from './useMutation';
import { LeaveGuard } from './LeaveGuard';

export function DraftEditor({
  api,
  detail,
  onDirty,
  onContinue,
  onReload,
  onSaved,
  onPending,
}: {
  api: ClinicalApi;
  detail: VisitDetail;
  onDirty: (dirty: boolean) => void;
  onContinue: () => void;
  onReload: () => void;
  onSaved: () => void;
  onPending?: (pending: boolean) => void;
}) {
  const last = detail.notes.at(-1);
  const apiRef = useRef(api);
  apiRef.current = api;
  const read = () => ({
    symptoms: last?.symptoms ?? '',
    findings: last?.findings ?? '',
    assessment: last?.assessment ?? '',
    diagnosis: last?.diagnosis ?? '',
  });
  const [fields, setFields] = useState(read);
  const [version, setVersion] = useState(detail.visit.version);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const mutation = useMutation();
  useEffect(() => {
    onPending?.(mutation.busy || mutation.uncertain);
  }, [mutation.busy, mutation.uncertain, onPending]);
  useEffect(() => () => onPending?.(false), [onPending]);
  const signed = detail.visit.state === 'SIGNED';
  useEffect(() => {
    onDirty(dirty || mutation.busy || mutation.uncertain);
  }, [dirty, mutation.busy, mutation.uncertain, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => {
    if (!dirty && detail.visit.version >= version) {
      setFields(read());
      setVersion(detail.visit.version);
    }
  }, [detail.visit.version, last?.id, dirty, version]);
  function save(continueAfter = false) {
    if (signed) {
      if (continueAfter) onContinue();
      return;
    }
    const input = { ...fields, expectedVersion: version };
    mutation.perform(
      (key) => apiRef.current.saveDraft(detail.visit.id, input, key),
      (result) => {
        setVersion(result.version);
        setDirty(false);
        onSaved();
        if (continueAfter) onContinue();
      },
      'Đã lưu bệnh án nháp.',
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <LeaveGuard
        active={dirty || mutation.busy || mutation.uncertain}
        pending={mutation.busy || mutation.uncertain}
      />
      {signed && (
        <Notice tone="success">
          Kết luận khám đã ký. Bạn có thể xem chỉ định và toa thuốc.
        </Notice>
      )}
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
              Thử lại yêu cầu lưu
            </button>
          )}
          {mutation.conflict && (
            <button type="button" onClick={() => setDiscard(true)}>
              Xem lại bản đã lưu
            </button>
          )}
        </Notice>
      )}
      {dirty && version !== detail.visit.version && (
        <Notice tone="warning">
          Lượt khám có phiên bản mới. Nội dung đang nhập được giữ lại.
        </Notice>
      )}
      <div className="huy-note-fields">
        {(
          [
            ['symptoms', 'Lý do khám & bệnh sử', 4],
            ['findings', 'Triệu chứng lâm sàng', 3],
            ['assessment', 'Đánh giá lâm sàng', 3],
            ['diagnosis', 'Chẩn đoán', 2],
          ] as const
        ).map(([name, label, rows]) => (
          <label key={name}>
            {label}
            <textarea
              aria-label={label}
              value={fields[name]}
              rows={rows}
              maxLength={10000}
              disabled={signed || mutation.locked}
              onChange={(e) => {
                setFields({ ...fields, [name]: e.target.value });
                setDirty(true);
              }}
              placeholder={
                signed
                  ? 'Chưa ghi nhận'
                  : `Nhập ${label.toLocaleLowerCase('vi-VN')}…`
              }
            />
          </label>
        ))}
      </div>
      <footer className="huy-exam-actions">
        <small>
          Lượt {shortId(detail.visit.id)} · Phiên bản {version}
          {dirty ? ' · Chưa lưu' : ''}
        </small>
        <div>
          {!signed && (
            <button
              type="submit"
              className="huy-button secondary"
              disabled={mutation.locked}
            >
              <Save size={16} aria-hidden="true" />
              {mutation.busy ? 'Đang lưu…' : 'Lưu nháp'}
            </button>
          )}
          <button
            type="button"
            className="huy-button"
            disabled={mutation.locked}
            onClick={() => (dirty ? save(true) : onContinue())}
          >
            Tiếp tục chỉ định
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </footer>
      {discard && (
        <ConfirmDialog
          title="Tải lại bệnh án đã lưu?"
          onClose={() => setDiscard(false)}
          onConfirm={() => {
            setFields(read());
            setVersion(detail.visit.version);
            setDirty(false);
            mutation.resolveConflict();
            setDiscard(false);
            onReload();
          }}
        >
          <p>Nội dung chưa lưu sẽ được thay bằng bản trên máy chủ.</p>
        </ConfirmDialog>
      )}
    </form>
  );
}

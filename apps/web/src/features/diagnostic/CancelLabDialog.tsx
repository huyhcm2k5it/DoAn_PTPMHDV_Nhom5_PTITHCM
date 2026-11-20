import { useEffect, useState } from 'react';
import type { DiagnosticApi, OrderDetail } from './types';
import { diagnosticMessage } from './api';
import {
  ConfirmDialog,
  Loading,
  Notice,
  shortId,
} from '../clinical/ClinicalUI';
import { useMutation } from '../clinical/useMutation';

export function CancelLabDialog({
  api,
  orderId,
  onClose,
  onCancelled,
}: {
  api: DiagnosticApi;
  orderId: string;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [detail, setDetail] = useState<OrderDetail>(),
    [error, setError] = useState<unknown>(),
    [reason, setReason] = useState('');
  const mutation = useMutation();
  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    api
      .detail(orderId, abort.signal)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((e) => {
        if (active) setError(e);
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [api, orderId]);
  const eligible =
    detail?.order.chargeState === 'PAID' &&
    detail.specimens.length === 0 &&
    detail.order.state === 'PAID';
  return (
    <ConfirmDialog
      title={'Hủy chỉ định #' + shortId(orderId)}
      onClose={onClose}
      busy={mutation.busy || mutation.uncertain}
      confirmDisabled={!eligible || !reason.trim() || mutation.conflict}
      confirmLabel="Hủy chỉ định"
      onConfirm={() => {
        if (
          !eligible ||
          !reason.trim() ||
          !detail ||
          !api.cancel ||
          mutation.locked
        )
          return;
        const body = {
          reasonCode: reason.trim(),
          expectedVersion: detail.order.version,
        };
        mutation.perform(
          (key) => api.cancel!(orderId, body, key),
          () => onCancelled(),
          'Đã hủy chỉ định.',
        );
      }}
    >
      {!detail && !error && <Loading>Đang kiểm tra điều kiện hủy…</Loading>}
      {error !== undefined && (
        <Notice tone="error">{diagnosticMessage(error)}</Notice>
      )}
      {detail && !eligible && (
        <Notice tone="warning">
          Chỉ hủy được xét nghiệm đã thanh toán và chưa từng lấy mẫu. Chỉ định
          này chưa đáp ứng điều kiện.
        </Notice>
      )}
      {eligible && (
        <>
          <p>
            Chỉ định đã thanh toán và chưa lấy mẫu. Trạng thái hoàn tiền được
            cập nhật từ viện phí.
          </p>
          <label>
            Lý do hủy
            <input
              required
              value={reason}
              maxLength={128}
              disabled={mutation.locked}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Nhập lý do hủy chỉ định"
            />
          </label>
        </>
      )}
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
            <p>
              Đóng hộp thoại và tải lại chỉ định để kiểm tra trạng thái mới.
            </p>
          )}
        </Notice>
      )}
    </ConfirmDialog>
  );
}

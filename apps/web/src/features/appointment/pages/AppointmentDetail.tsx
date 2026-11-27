import { appointmentLabels, formatAppointmentTime } from '../display';
import { useRef, useState } from 'react';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import type { AppointmentApi, AvailableSlot } from '../types';
import { Loading } from '../../../shared/ui/Loading';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import { useAppointmentPolling } from '../hooks/useAppointmentPolling';

import { AppointmentRecords } from './AppointmentRecords';
import type { ClinicalApi } from '../../clinical/types';
import type { DiagnosticApi } from '../../diagnostic/types';

const refundLabels: Record<string, string> = {
  PENDING_SYNC: 'Đang đồng bộ yêu cầu hoàn tiền',
  REQUESTED: 'Đã yêu cầu hoàn tiền',
  SUCCEEDED: 'Đã hoàn tiền',
  FAILED: 'Hoàn tiền thất bại',
  NONE: 'Đã hủy, chưa thu phí',
};

export function AppointmentDetail({
  api,
  mode,
  records,
}: {
  api: AppointmentApi;
  mode?: 'reschedule' | 'cancel';
  records?: { clinical: ClinicalApi; diagnostic: DiagnosticApi };
}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requestedBack = params.get('returnTo');
  const back = requestedBack?.startsWith('/patient/appointments?')
    ? requestedBack
    : '/patient/appointments';
  const context = 'returnTo=' + encodeURIComponent(back);
  const { appointmentId = '' } = useParams();
  const { data, error, retry } = useAppointmentPolling(api, appointmentId);
  const [reasonCode, setReasonCode] = useState('PATIENT_REQUEST');
  const [newSlotId, setNewSlotId] = useState('');
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<AvailableSlot[]>();
  const [searching, setSearching] = useState(false);
  const [actionError, setActionError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const intention = useRef<{ signature: string; key: string } | null>(null);
  function mutationKey(signature: string) {
    if (intention.current?.signature !== signature)
      intention.current = { signature, key: crypto.randomUUID() };
    return intention.current.key;
  }

  if (error != null) {
    return (
      <section className="page-content">
        <ErrorPanel error={error} onRetry={retry} />
      </section>
    );
  }
  if (!data) {
    return (
      <section className="page-content">
        <Loading label="Đang tải lịch hẹn" />
      </section>
    );
  }

  const appointment = data.appointment ?? {};
  const appointmentState = String(appointment.state ?? data.state);
  const version = Number(appointment.version ?? 0);
  const refund = String(data.refundStatus ?? appointment.refundStatus ?? '');
  const refundLabel = refundLabels[refund] ?? (refund || 'Chưa phát sinh');
  const patientId =
    typeof appointment.patientId === 'string' ? appointment.patientId : '';
  const tab = params.get('tab');
  const recordTab = tab === 'lab' || tab === 'prescription' ? tab : undefined;

  const detailPath =
    '/patient/appointments/' + encodeURIComponent(appointmentId);
  const canCancel =
    ['PENDING_PAYMENT', 'CONFIRMED'].includes(appointmentState) &&
    Boolean(api.cancel && version);
  const canReschedule =
    appointmentState === 'CONFIRMED' && Boolean(api.reschedule && version);
  async function findSlots(event: React.FormEvent) {
    event.preventDefault();
    if (
      typeof appointment.doctorId !== 'string' ||
      typeof appointment.serviceId !== 'string'
    )
      return;
    setSearching(true);
    setNewSlotId('');
    setSlots(undefined);
    setActionError(undefined);
    try {
      setSlots(
        (
          await api.listAvailable({
            doctorId: appointment.doctorId,
            serviceId: appointment.serviceId,
            date,
          })
        ).filter(
          (slot) =>
            slot.slotId !== appointment.slotId && slot.remainingCapacity > 0,
        ),
      );
    } catch (caught) {
      setActionError(caught);
    } finally {
      setSearching(false);
    }
  }
  async function cancel() {
    if (busy || !canCancel) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await api.cancel?.(
        appointmentId,
        { reasonCode, expectedVersion: version },
        mutationKey(
          JSON.stringify([appointmentId, 'cancel', reasonCode, version]),
        ),
      );
      navigate(detailPath, { replace: true });
      retry();
    } catch (caught) {
      setActionError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function reschedule() {
    if (busy || !canReschedule || !newSlotId) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await api.reschedule?.(
        appointmentId,
        { newSlotId, expectedVersion: version },
        mutationKey(
          JSON.stringify([appointmentId, 'reschedule', newSlotId, version]),
        ),
      );
      navigate(detailPath, { replace: true });
      retry();
    } catch (caught) {
      setActionError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page-content quan-workflow">
      <Link className="back-link" to={back}>
        ← Lịch hẹn
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CHI TIẾT LỊCH HẸN</p>
          <h1>
            {mode === 'cancel'
              ? 'Hủy lịch khám'
              : mode === 'reschedule'
                ? 'Đổi lịch khám'
                : 'Chi tiết lịch khám'}
          </h1>
          <p>{data.appointmentId}</p>
          <p>Theo dõi trạng thái do Appointment/Billing xác nhận.</p>
        </div>
        <span
          className="status-pill"
          title={appointmentLabels[appointmentState]}
        >
          {appointmentLabels[appointmentState] ?? appointmentState}
        </span>
      </div>
      {!mode && records && patientId && (
        <nav className="quan-record-tabs" aria-label="Nội dung lịch khám">
          <Link
            aria-current={!recordTab ? 'page' : undefined}
            to={detailPath + '?' + context}
          >
            Lịch hẹn của tôi
          </Link>
          <Link
            aria-current={recordTab === 'lab' ? 'page' : undefined}
            to={detailPath + '?tab=lab&' + context}
          >
            Kết quả xét nghiệm
          </Link>
          <Link
            aria-current={recordTab === 'prescription' ? 'page' : undefined}
            to={detailPath + '?tab=prescription&' + context}
          >
            Đơn thuốc
          </Link>
        </nav>
      )}
      {!mode && records && patientId && recordTab ? (
        <AppointmentRecords
          key={appointmentId + recordTab}
          appointmentId={appointmentId}
          patientId={patientId}
          returnTo={detailPath + '?' + context}
          view={recordTab}
          {...records}
        />
      ) : (
        <>
          <dl className="detail-grid state-card">
            <div>
              <dt>Thời gian khám</dt>
              <dd>{formatAppointmentTime(appointment.startAt)}</dd>
            </div>
            <div>
              <dt>Đồng bộ phí</dt>
              <dd>
                {(typeof data.chargeSync === 'object'
                  ? data.chargeSync?.state
                  : data.chargeSync) ?? 'PENDING'}
              </dd>
            </div>
            <div>
              <dt>Trạng thái phí</dt>
              <dd>{data.chargeStatus ?? 'PENDING'}</dd>
            </div>
            <div>
              <dt>Trạng thái hoàn</dt>
              <dd>
                {appointmentState === 'CANCELLED'
                  ? refundLabel
                  : 'Chưa phát sinh'}
              </dd>
            </div>
            <div>
              <dt>Mã hồ sơ</dt>
              <dd>{String(appointment.patientId ?? 'Chưa có')}</dd>
            </div>
          </dl>
          {appointmentState === 'CANCELLED' &&
            ['PENDING_SYNC', 'REQUESTED', 'FAILED'].includes(refund) && (
              <button
                type="button"
                className="button button-secondary"
                onClick={retry}
              >
                Cập nhật kết quả hoàn tiền
              </button>
            )}
          {actionError != null && (
            <ErrorPanel
              error={actionError}
              onRetry={() => setActionError(undefined)}
            />
          )}
          {!mode && (
            <div className="quan-actions">
              {canReschedule && (
                <Link
                  className="button button-secondary"
                  to={detailPath + '/reschedule?' + context}
                >
                  Đổi lịch
                </Link>
              )}
              {canCancel && (
                <Link
                  className="button button-secondary"
                  to={detailPath + '/cancel?' + context}
                >
                  Hủy lịch
                </Link>
              )}
            </div>
          )}
          {mode === 'cancel' && canCancel && (
            <form
              className="state-card quan-review"
              onSubmit={(event) => {
                event.preventDefault();
                void cancel();
              }}
            >
              <label>
                Lý do hủy
                <select
                  value={reasonCode}
                  onChange={(event) => setReasonCode(event.target.value)}
                >
                  <option value="PATIENT_REQUEST">
                    Thay đổi kế hoạch cá nhân
                  </option>
                  <option value="HEALTH_REASON">Lý do sức khỏe</option>
                  <option value="OTHER">Lý do khác</option>
                </select>
              </label>
              <div className="quan-actions">
                <Link to={detailPath + '?' + context}>Quay lại</Link>
                <button className="button quan-danger" disabled={busy}>
                  Xác nhận hủy lịch
                </button>
              </div>
            </form>
          )}
          {mode === 'reschedule' && canReschedule && (
            <div className="state-card quan-review">
              <form className="quan-actions" onSubmit={findSlots}>
                <label>
                  Ngày khám mới
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(event) => {
                      setDate(event.target.value);
                      setNewSlotId('');
                      setSlots(undefined);
                    }}
                    disabled={busy || searching}
                  />
                </label>
                <button
                  className="button button-secondary"
                  disabled={busy || searching}
                >
                  {searching ? 'Đang tìm…' : 'Tìm khung giờ'}
                </button>
              </form>
              {slots?.length === 0 && <p>Không có khung giờ phù hợp.</p>}
              {slots && slots.length > 0 && (
                <label>
                  Khung giờ mới
                  <select
                    value={newSlotId}
                    disabled={busy}
                    onChange={(event) => setNewSlotId(event.target.value)}
                  >
                    <option value="">Chọn khung giờ</option>
                    {slots.map((slot) => (
                      <option key={slot.slotId} value={slot.slotId}>
                        {formatAppointmentTime(slot.startAt)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="quan-actions">
                <Link to={detailPath + '?' + context}>Quay lại</Link>
                <button
                  className="button button-primary"
                  disabled={!newSlotId || busy || searching}
                  onClick={() => void reschedule()}
                >
                  Xác nhận đổi lịch
                </button>
              </div>
            </div>
          )}
          {((mode === 'cancel' && !canCancel) ||
            (mode === 'reschedule' && !canReschedule)) && (
            <p role="status">
              Trạng thái hiện tại không cho phép thao tác này.{' '}
              <Link to={detailPath + '?' + context}>
                Xem chi tiết lịch khám
              </Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}

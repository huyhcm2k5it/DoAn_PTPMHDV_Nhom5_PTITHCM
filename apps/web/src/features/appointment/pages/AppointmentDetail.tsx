import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AppointmentApi } from '../types';
import { Loading } from '../../../shared/ui/Loading';
import { ErrorPanel } from '../../../shared/ui/ErrorPanel';
import { useAppointmentPolling } from '../hooks/useAppointmentPolling';

export function AppointmentDetail({ api }: { api: AppointmentApi }) {
  const { appointmentId = '' } = useParams();
  const { data, error, retry } = useAppointmentPolling(api, appointmentId);
  const [reasonCode, setReasonCode] = useState('PATIENT_REQUEST');
  const [newSlotId, setNewSlotId] = useState('');
  const [actionError, setActionError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

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

  async function cancel() {
    if (!version) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await api.cancel?.(
        appointmentId,
        { reasonCode, expectedVersion: version },
        crypto.randomUUID(),
      );
      retry();
    } catch (caught) {
      setActionError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function reschedule() {
    if (!version || !newSlotId) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await api.reschedule?.(
        appointmentId,
        { newSlotId, expectedVersion: version },
        crypto.randomUUID(),
      );
      retry();
    } catch (caught) {
      setActionError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page-content">
      <Link className="back-link" to="/patient/appointments">
        ← Lịch hẹn
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CHI TIẾT LỊCH HẸN</p>
          <h1>{data.appointmentId}</h1>
          <p>Theo dõi trạng thái do Appointment/Billing xác nhận.</p>
        </div>
        <span className="status-pill">{appointmentState}</span>
      </div>
      <dl className="detail-grid">
        <div>
          <dt>Đồng bộ phí</dt>
          <dd>{data.chargeSync ?? 'PENDING'}</dd>
        </div>
        <div>
          <dt>Trạng thái phí</dt>
          <dd>{data.chargeStatus ?? 'PENDING'}</dd>
        </div>
        <div>
          <dt>Trạng thái hoàn</dt>
          <dd>{data.refundStatus ?? 'Chưa phát sinh'}</dd>
        </div>
        <div>
          <dt>Mã hồ sơ</dt>
          <dd>{String(appointment.patientId ?? 'Chưa có')}</dd>
        </div>
      </dl>
      {actionError != null && (
        <ErrorPanel
          error={actionError}
          onRetry={() => setActionError(undefined)}
        />
      )}
      {['PENDING_PAYMENT', 'CONFIRMED'].includes(appointmentState) && (
        <div className="search-panel">
          <label>
            Lý do hủy
            <input
              value={reasonCode}
              onChange={(event) => setReasonCode(event.target.value)}
            />
          </label>
          <button
            className="button button-secondary"
            type="button"
            disabled={busy}
            onClick={() => void cancel()}
          >
            Hủy lịch
          </button>
          {appointmentState === 'CONFIRMED' && (
            <>
              <label>
                Slot mới
                <input
                  value={newSlotId}
                  onChange={(event) => setNewSlotId(event.target.value)}
                  placeholder="UUID slot"
                />
              </label>
              <button
                className="button button-primary"
                type="button"
                disabled={busy || !newSlotId}
                onClick={() => void reschedule()}
              >
                Đổi lịch
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

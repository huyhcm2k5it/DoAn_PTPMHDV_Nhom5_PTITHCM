import { useNavigate, useSearchParams } from 'react-router-dom';
import { ClinicalFeature } from './ClinicalFeature';
import type { ClinicalApi, ClinicalSession, StartInput } from './types';
import type { DiagnosticApi } from '../diagnostic/types';
import { Notice } from './ClinicalUI';

export function ClinicalRoute({
  api,
  diagnosticApi,
  session,
  view = 'exam',
}: {
  api: ClinicalApi;
  diagnosticApi: DiagnosticApi;
  session?: ClinicalSession;
  view?: 'exam' | 'treatment';
}) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const ticketId = params.get('ticketId'),
    doctorId = params.get('doctorId');
  const version =
    params.get('ticketVersion') ?? params.get('expectedTicketVersion');
  const visitId = params.get('visitId') ?? '';
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let ticket: StartInput | undefined;
  if (ticketId || doctorId || version) {
    if (
      !ticketId ||
      !doctorId ||
      !version ||
      !uuid.test(ticketId) ||
      !uuid.test(doctorId) ||
      !Number.isSafeInteger(Number(version)) ||
      Number(version) < 1 ||
      Number(version) > 2147483647
    )
      return (
        <section className="huy-workspace">
          <Notice tone="error">
            Vé chuyển từ tiếp nhận thiếu thông tin hoặc không hợp lệ. Vui lòng
            chọn lại vé.
          </Notice>
        </section>
      );
    ticket = { ticketId, doctorId, expectedTicketVersion: Number(version) };
  }
  if (visitId && !uuid.test(visitId))
    return (
      <section className="huy-workspace">
        <Notice tone="error">Mã lượt khám không hợp lệ.</Notice>
      </section>
    );
  return (
    <ClinicalFeature
      key={[view, visitId, ticketId ?? '', version ?? ''].join(':')}
      api={api}
      diagnosticApi={diagnosticApi}
      session={session}
      selectedTicket={ticket}
      initialView={view}
      initialVisitId={visitId}
      onNavigate={(next, selectedVisit) => {
        const route =
          next === 'exam' ? '/doctor/clinical' : '/doctor/treatment';
        navigate(
          route +
            (selectedVisit
              ? '?' + new URLSearchParams({ visitId: selectedVisit }).toString()
              : ''),
        );
      }}
    />
  );
}

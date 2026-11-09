import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ClinicalFeature, createClinicalApi } from '../../../apps/web/src/features/clinical';
import { DiagnosticFeature, createDiagnosticApi } from '../../../apps/web/src/features/diagnostic';

function Preview() {
  const [token, setToken] = useState('');
  const [userId, setUserId] = useState('11111111-0000-0000-0000-000000000001');
  const [screen, setScreen] = useState('doctor');
  const [lease, setLease] = useState('');
  const latest = useRef(token);
  latest.current = token;
  const currentLease = useRef(lease);
  currentLease.current = lease;
  const transport = useMemo(
    () => (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (latest.current) headers.set('Authorization', `Bearer ${latest.current}`);
      return fetch(url, { ...init, headers });
    },
    [],
  );
  const api = useMemo(
    () => createClinicalApi(transport, { authorizationLease: async () => currentLease.current }),
    [transport],
  );
  const diagnostic = useMemo(() => createDiagnosticApi(transport), [transport]);
  return (
    <>
      <details style={{ padding: 16, fontFamily: 'system-ui', background: '#e9eff2' }}>
        <summary>Cấu hình runner phát triển — không phải màn đăng nhập sản phẩm</summary>
        <label>
          Bearer token{' '}
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        <label>
          Màn hình thử nghiệm
          <select value={screen} onChange={(event) => setScreen(event.target.value)}>
            <option value="doctor">Bác sĩ</option>
            <option value="tech">LAB_TECH</option>
            <option value="review">LAB_REVIEW (chỉ đọc)</option>
          </select>
        </label>
        <label>
          Authorization lease cho thao tác ký
          <input
            type="password"
            autoComplete="off"
            value={lease}
            onChange={(event) => setLease(event.target.value)}
          />
        </label>
        <label>
          JWT subject dùng thử{' '}
          <input value={userId} onChange={(event) => setUserId(event.target.value)} />
        </label>
        <p>
          Token và lease chỉ giữ trong bộ nhớ. Clinical chạy trên 8008, Diagnostic 8009, Catalog
          8007. Vé fixture giữ PENDING tới khi Appointment phản hồi thật.
        </p>
      </details>
      {screen === 'doctor' ? (
        <ClinicalFeature
          api={api}
          session={{ userId, actorType: 'DOCTOR' }}
          selectedTicket={{
            ticketId: '55555555-0000-0000-0000-000000000001',
            doctorId: '22222222-0000-0000-0000-000000000001',
            expectedTicketVersion: 1,
          }}
        />
      ) : (
        <DiagnosticFeature
          api={diagnostic}
          session={{
            userId,
            actorType: 'STAFF',
            capabilities: [screen === 'tech' ? 'LAB_TECH' : 'LAB_REVIEW'],
          }}
        />
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);

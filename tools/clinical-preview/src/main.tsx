import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ClinicalFeature,
  createClinicalApi,
} from "../../../apps/web/src/features/clinical";

function Preview() {
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState("11111111-0000-0000-0000-000000000001");
  const latest = useRef(token);
  latest.current = token;
  const api = useMemo(
    () =>
      createClinicalApi((url, init) => {
        const headers = new Headers(init?.headers);
        if (latest.current)
          headers.set("Authorization", `Bearer ${latest.current}`);
        return fetch(url, { ...init, headers });
      }),
    [],
  );
  return (
    <>
      <details
        style={{ padding: 16, fontFamily: "system-ui", background: "#e9eff2" }}
      >
        <summary>
          Cấu hình runner phát triển — không phải màn đăng nhập sản phẩm
        </summary>
        <label>
          Bearer token{" "}
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        <label>
          JWT subject dùng thử{" "}
          <input
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          />
        </label>
        <p>
          Token chỉ giữ trong bộ nhớ. API thật chạy trên 8082. Vé fixture giữ
          PENDING tới khi Appointment phản hồi thật.
        </p>
      </details>
      <ClinicalFeature
        api={api}
        session={{ userId, actorType: "DOCTOR" }}
        selectedTicket={{
          ticketId: "55555555-0000-0000-0000-000000000001",
          doctorId: "22222222-0000-0000-0000-000000000001",
          expectedTicketVersion: 1,
        }}
      />
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);

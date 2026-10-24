import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CatalogPage,
  createCatalogApi,
} from "../../../apps/web/src/features/catalog";
import type { Session } from "../../../apps/web/src/features/catalog";
// Development preview only. Decode controls visibility, never server authorization.
function hint(token: string): Session | undefined {
  try {
    const part = token.split(".")[1];
    const claims = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    if (!["PATIENT", "DOCTOR", "STAFF"].includes(claims.actorType))
      return undefined;
    return {
      actorType: claims.actorType,
      capabilities: Array.isArray(claims.capabilities)
        ? claims.capabilities.filter((x: unknown) => typeof x === "string")
        : [],
    };
  } catch {
    return undefined;
  }
}
function Preview() {
  const [token, setToken] = useState("");
  const [lease, setLease] = useState("");
  const [handoff, setHandoff] = useState("");
  const credentials = useRef({ token, lease });
  credentials.current = { token, lease };
  const session = useMemo(() => hint(token), [token]);
  const api = useMemo(
    () =>
      createCatalogApi((url, init) => {
        const current = credentials.current;
        const headers = new Headers(init?.headers);
        if (current.token)
          headers.set("Authorization", `Bearer ${current.token}`);
        if (current.lease && init?.method === "POST")
          headers.set("X-Authorization-Lease", current.lease);
        return fetch(url, { ...init, headers, credentials: "omit" });
      }),
    [],
  );
  return (
    <>
      <details
        style={{
          margin: "16px auto",
          padding: "14px",
          maxWidth: 1100,
          border: "1px solid #ccdbe3",
          fontFamily: "Segoe UI,sans-serif",
        }}
      >
        <summary>Chế độ phát triển — kết nối Catalog local :8081</summary>
        <p>
          Giao diện W03 của Huy để ghép vào shell chung. Danh mục công khai
          không cần đăng nhập. API có quyền cần token và access projection thật;
          không có nút cấp quyền giả. Token chỉ nằm trong bộ nhớ trang.
        </p>
        <label style={{ display: "block" }}>
          Access token từ Identity{" "}
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        <label style={{ display: "block" }}>
          Lease CA-004 (tối đa 30 giây){" "}
          <input
            type="password"
            autoComplete="off"
            value={lease}
            onChange={(e) => setLease(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        <button
          onClick={() => {
            setToken("");
            setLease("");
          }}
        >
          Xóa thông tin phiên
        </button>
        <p>
          Đọc token ở trình duyệt chỉ để ẩn/hiện giao diện; backend luôn kiểm
          chữ ký và quyền hiện tại.
        </p>
      </details>
      {handoff && (
        <p
          role="status"
          style={{
            maxWidth: 1100,
            margin: "auto",
            padding: 16,
            background: "#e9f6f4",
          }}
        >
          {handoff} Chờ nối màn hình lịch của Quân; chưa tạo lịch khám.
        </p>
      )}
      <CatalogPage
        key={token ? hintSubject(token) : "public"}
        api={api}
        session={session}
        onChooseDoctor={(id) => setHandoff(`Đã chọn doctorId: ${id}.`)}
        onChooseService={(id) => setHandoff(`Đã chọn medicalServiceId: ${id}.`)}
      />
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
);
function hintSubject(token: string) {
  try {
    return String(
      JSON.parse(
        atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
      ).sub ?? "unknown",
    );
  } catch {
    return "invalid";
  }
}

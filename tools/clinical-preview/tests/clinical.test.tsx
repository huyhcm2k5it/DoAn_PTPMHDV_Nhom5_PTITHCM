import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ClinicalFeature } from "../../../apps/web/src/features/clinical/ClinicalFeature";
import {
  ApiError,
  createClinicalApi,
} from "../../../apps/web/src/features/clinical/api";
import type {
  ClinicalApi,
  Visit,
} from "../../../apps/web/src/features/clinical/types";

afterEach(cleanup);
const uid = "11111111-0000-0000-0000-000000000001";
const id = "77777777-0000-0000-0000-000000000001";
const visit: Visit = {
  id,
  appointmentId: "a",
  patientId: "p",
  doctorUserId: uid,
  departmentId: "d",
  claimId: "c",
  state: "IN_PROGRESS",
  version: 1,
  returnRound: 0,
  startedAt: "2026-10-27T01:00:00Z",
};
const ticket = {
  ticketId: "55555555-0000-0000-0000-000000000001",
  doctorId: "22222222-0000-0000-0000-000000000001",
  expectedTicketVersion: 1,
};
const session = { userId: uid, actorType: "DOCTOR" as const };
function api(): ClinicalApi {
  return {
    worklist: vi
      .fn()
      .mockResolvedValue({ items: [visit], total: 1, startRequest: null }),
    start: vi.fn(),
    detail: vi.fn().mockResolvedValue({
      visit,
      notes: [],
      prescriptions: [],
      labRequests: [],
    }),
    saveDraft: vi
      .fn()
      .mockResolvedValue({ visitId: id, version: 2, state: "IN_PROGRESS" }),
  };
}

describe("clinical doctor workflow", () => {
  it("uses the corrected ticket selection after a definitive start conflict", async () => {
    const client = api();
    vi.mocked(client.start).mockRejectedValueOnce(
      new ApiError(409, "TICKET_VERSION_CONFLICT", "Vé đã thay đổi"),
    );
    const view = render(
      <ClinicalFeature
        api={client}
        session={session}
        selectedTicket={ticket}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Nhận lượt khám" }));
    await screen.findByRole("alert");
    const previous = vi.mocked(client.start).mock.calls[0];
    vi.mocked(client.start).mockResolvedValue({
      requestId: id,
      operationId: id,
      state: "PENDING",
      statusUrl: "",
    });
    view.rerender(
      <ClinicalFeature
        api={client}
        session={session}
        selectedTicket={{ ...ticket, expectedTicketVersion: 2 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Nhận lượt khám" }));
    await waitFor(() => expect(client.start).toHaveBeenCalledTimes(2));
    const next = vi.mocked(client.start).mock.calls[1];
    expect(next[0].expectedTicketVersion).toBe(2);
    expect(next[1]).not.toBe(previous[1]);
  });
  it("keeps the same start body and key after an ambiguous network failure", async () => {
    const client = api();
    vi.mocked(client.start).mockRejectedValue(new Error("network interrupted"));
    const view = render(
      <ClinicalFeature
        api={client}
        session={session}
        selectedTicket={ticket}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Nhận lượt khám" }));
    await screen.findByRole("alert");
    const previous = vi.mocked(client.start).mock.calls[0];
    view.rerender(
      <ClinicalFeature
        api={client}
        session={session}
        selectedTicket={{ ...ticket, expectedTicketVersion: 2 }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Thử lại yêu cầu nhận lượt" }),
    );
    await waitFor(() => expect(client.start).toHaveBeenCalledTimes(2));
    expect(vi.mocked(client.start).mock.calls[1]).toEqual(previous);
  });
  it("shows pending and opens a visit only after ACCEPTED", async () => {
    const client = api();
    let accept: (value: any) => void = () => {};
    vi.mocked(client.start).mockResolvedValue({
      requestId: id,
      operationId: id,
      state: "PENDING",
      statusUrl: "/api/v1/clinical/worklist?operationId=" + id,
    });
    vi.mocked(client.worklist).mockImplementation((q) =>
      q.operationId
        ? new Promise((resolve) => {
            accept = resolve;
          })
        : Promise.resolve({ items: [], total: 0, startRequest: null }),
    );
    render(
      <ClinicalFeature
        api={client}
        session={session}
        selectedTicket={ticket}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Nhận lượt khám" }));
    await screen.findByText(/Đang chờ xác nhận vé/);
    expect(client.detail).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(client.worklist).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: id }),
        expect.any(AbortSignal),
      ),
    );
    accept({
      items: [visit],
      total: 1,
      startRequest: {
        requestId: id,
        operationId: id,
        state: "ACCEPTED",
        statusUrl: "",
        visitId: id,
      },
    });
    await screen.findByLabelText("Triệu chứng");
    expect(client.detail).toHaveBeenCalledWith(id, expect.any(AbortSignal));
  });
  it("displays rejected claims without opening a visit", async () => {
    const client = api();
    vi.mocked(client.start).mockResolvedValue({
      requestId: id,
      operationId: id,
      state: "PENDING",
      statusUrl: "",
    });
    vi.mocked(client.worklist).mockImplementation((q) =>
      Promise.resolve({
        items: [],
        total: 0,
        startRequest: q.operationId
          ? {
              requestId: id,
              operationId: id,
              state: "REJECTED",
              statusUrl: "",
              reasonCode: "TICKET_ALREADY_CLAIMED",
            }
          : null,
      }),
    );
    render(
      <ClinicalFeature
        api={client}
        session={session}
        selectedTicket={ticket}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Nhận lượt khám" }));
    await screen.findByText(/TICKET_ALREADY_CLAIMED/);
    expect(client.detail).not.toHaveBeenCalled();
  });
  it("retains draft, version and retry key across a transport refresh", async () => {
    const client = api();
    vi.mocked(client.saveDraft).mockRejectedValue(
      new ApiError(503, "SERVICE_UNAVAILABLE", "Thử lại"),
    );
    const view = render(<ClinicalFeature api={client} session={session} />);
    fireEvent.click(await screen.findByRole("button", { name: /Mở lượt/ }));
    fireEvent.change(await screen.findByLabelText("Triệu chứng"), {
      target: { value: "Bản nháp cần giữ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lưu bản nháp" }));
    await screen.findByRole("alert");
    const first = vi.mocked(client.saveDraft).mock.calls[0];
    expect(first[1]).toEqual({
      symptoms: "Bản nháp cần giữ",
      findings: "",
      assessment: "",
      diagnosis: "",
      expectedVersion: 1,
    });
    const refreshed = {
      ...client,
      saveDraft: vi
        .fn()
        .mockResolvedValue({ visitId: id, version: 2, state: "IN_PROGRESS" }),
    };
    view.rerender(<ClinicalFeature api={refreshed} session={session} />);
    expect(
      (screen.getByLabelText("Triệu chứng") as HTMLTextAreaElement).value,
    ).toBe("Bản nháp cần giữ");
    fireEvent.click(screen.getByRole("button", { name: "Lưu bản nháp" }));
    await waitFor(() => expect(refreshed.saveDraft).toHaveBeenCalled());
    expect(refreshed.saveDraft.mock.calls[0][2]).toBe(first[2]);
  });
  it("keeps local text after 409 and offers an explicit reload", async () => {
    const client = api();
    vi.mocked(client.saveDraft).mockRejectedValue(
      new ApiError(409, "VISIT_VERSION_CONFLICT", "Lượt đã thay đổi"),
    );
    render(<ClinicalFeature api={client} session={session} />);
    fireEvent.click(await screen.findByRole("button", { name: /Mở lượt/ }));
    fireEvent.change(await screen.findByLabelText("Chẩn đoán"), {
      target: { value: "Chưa lưu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lưu bản nháp" }));
    await screen.findByRole("alert");
    expect(
      (screen.getByLabelText("Chẩn đoán") as HTMLTextAreaElement).value,
    ).toBe("Chưa lưu");
    expect(screen.getByRole("button", { name: /Tải bản mới/ })).toBeTruthy();
  });
  it("does not query or show doctor drafts to patients", () => {
    const client = api();
    render(
      <ClinicalFeature
        api={client}
        session={{ userId: uid, actorType: "PATIENT" }}
      />,
    );
    expect(screen.getByText(/chỉ dành cho bác sĩ/)).toBeTruthy();
    expect(client.worklist).not.toHaveBeenCalled();
  });
});
it("keeps Idempotency-Key and correlation error at the API boundary", async () => {
  const transport = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        error: { code: "VISIT_VERSION_CONFLICT", message: "Changed" },
        meta: { correlationId: "trace-1" },
      }),
      { status: 409 },
    ),
  );
  const client = createClinicalApi(transport);
  await expect(
    client.saveDraft(
      id,
      {
        symptoms: "",
        findings: "",
        assessment: "",
        diagnosis: "",
        expectedVersion: 1,
      },
      id,
    ),
  ).rejects.toMatchObject({
    status: 409,
    code: "VISIT_VERSION_CONFLICT",
    correlationId: "trace-1",
  });
  expect(transport.mock.calls[0][0]).toBe(`/api/v1/visits/${id}/draft`);
  expect(transport.mock.calls[0][1].headers["Idempotency-Key"]).toBe(id);
});

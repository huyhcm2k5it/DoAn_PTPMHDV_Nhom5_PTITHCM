import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ProfileList } from "../src/features/patient/pages/ProfileList";
import { ProfileDetail } from "../src/features/patient/pages/ProfileDetail";
import { AvailableSlots } from "../src/features/appointment/pages/AvailableSlots";
import { withAuthRedirect } from "../src/app/runtime";
import type { PatientApi } from "../src/features/patient/types";
import type { CatalogApi } from "../src/features/catalog/types";

const profile = { id: "8cfd2182-b236-4f51-a44c-92c576a72a7f", fullName: "Nguyễn An", birthDate: "1998-06-12", relation: "SELF" as const };
function patientApi(overrides: Partial<PatientApi> = {}): PatientApi {
  return { list: vi.fn().mockResolvedValue({ items: [profile], total: 1 }), getById: vi.fn().mockResolvedValue(profile), ...overrides };
}

describe("patient profile screens", () => {
  it("shows loading and then the empty state for an account without profiles", async () => {
    const api = patientApi({ list: vi.fn().mockResolvedValue({ items: [], total: 0 }) });
    render(<MemoryRouter><ProfileList api={api} /></MemoryRouter>);
    expect(screen.getByRole("status").textContent).toContain("Đang tải hồ sơ");
    expect(await screen.findByText("Bạn chưa có hồ sơ nào")).toBeTruthy();
  });

  it("renders a permission message for a 403 profile detail response", async () => {
    const api = patientApi({ getById: vi.fn().mockRejectedValue({ status: 403 }) });
    render(<MemoryRouter><ProfileDetail api={api} patientId={profile.id} /></MemoryRouter>);
    expect(await screen.findByText("Tài khoản hiện tại không có quyền xem nội dung này.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Thử tải lại" })).toBeNull();
  });

  it("offers a safe retry after a 503 list response", async () => {
    const list = vi.fn().mockRejectedValueOnce({ status: 503 }).mockResolvedValueOnce({ items: [profile], total: 1 });
    render(<MemoryRouter><ProfileList api={patientApi({ list })} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Thử tải lại" }));
    expect(await screen.findByText("Nguyễn An")).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe("available slot screen", () => {
  it("uses selected Catalog IDs and date for a public slot lookup", async () => {
    const catalog = {
      departments: vi.fn().mockResolvedValue([{ id: "dep-1", code: "CARD", name: "Tim mạch", status: "ACTIVE" }]),
      doctors: vi.fn().mockResolvedValue({ items: [{ id: "doc-1", departmentId: "dep-1", displayName: "BS. An", status: "ACTIVE" }], total: 1 }),
      services: vi.fn().mockResolvedValue([{ id: "svc-1", departmentId: "dep-1", code: "EXAM", name: "Khám tổng quát", status: "ACTIVE", price: null }]),
    } as unknown as CatalogApi;
    const listAvailable = vi.fn().mockResolvedValue([]);
    const appointmentApi = { listAvailable, createHold: vi.fn(), releaseHold: vi.fn(), createAppointment: vi.fn(), getAppointment: vi.fn(), listAppointments: vi.fn() };
    render(<MemoryRouter><AvailableSlots api={appointmentApi} catalog={catalog} /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText("Chuyên khoa"), { target: { value: "dep-1" } });
    fireEvent.change(await screen.findByLabelText("Bác sĩ"), { target: { value: "doc-1" } });
    fireEvent.change(await screen.findByLabelText("Dịch vụ khám"), { target: { value: "svc-1" } });
    fireEvent.change(screen.getByLabelText("Ngày khám"), { target: { value: "2026-11-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Tìm lịch trống" }));

    expect(await screen.findByText("Không có khung giờ phù hợp")).toBeTruthy();
    expect(listAvailable).toHaveBeenCalledWith({ doctorId: "doc-1", serviceId: "svc-1", date: "2026-11-02" }, expect.any(AbortSignal));
  });
});

describe("shared auth redirect boundary", () => {
  it("hands a 401 response back to the shared Identity adapter", async () => {
    const onUnauthorized = vi.fn();
    const transport = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    const response = await withAuthRedirect(transport, onUnauthorized)("/api/v1/patients?page=1&limit=20");
    expect(response.status).toBe(401);
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledTimes(1));
  });
});

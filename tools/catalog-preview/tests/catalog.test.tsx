import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { CatalogPage } from "../../../apps/web/src/features/catalog/CatalogPage";
import { PriceForm } from "../../../apps/web/src/features/catalog/PriceForm";
import { ApiError } from "../../../apps/web/src/features/catalog/api";
import type {
  CatalogApi,
  MedicalService,
} from "../../../apps/web/src/features/catalog/types";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const item: MedicalService = {
  id: "00000000-0000-4000-8000-000000000201",
  departmentId: "d1",
  code: "EXAM",
  name: "Khám tổng quát",
  status: "ACTIVE",
  price: null,
};
function api(): CatalogApi {
  return {
    departments: vi.fn().mockResolvedValue([
      { id: "d1", code: "K1", name: "Khoa Nội", status: "ACTIVE" },
      { id: "d2", code: "K2", name: "Khoa Ngoại", status: "ACTIVE" },
    ]),
    doctors: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    services: vi.fn().mockResolvedValue([item]),
    medicines: vi.fn().mockResolvedValue([]),
    labTests: vi.fn().mockResolvedValue([]),
    createPrice: vi.fn().mockResolvedValue({
      priceVersionId: "p1",
      revision: 2,
      effectiveFrom: "2030-01-01T00:00:00Z",
    }),
  };
}
describe("W03 catalog", () => {
  it("shows loading, real empty states, unavailable price and no public staff controls", async () => {
    render(<CatalogPage api={api()} />);
    expect(screen.getByRole("status").textContent).toContain("Đang tải");
    await screen.findByText("Khám tổng quát");
    expect(screen.getByText("Chưa có giá hiệu lực")).toBeTruthy();
    expect(screen.getByText("Chưa có bác sĩ trong danh mục này.")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Tạo phiên bản giá" }),
    ).toBeNull();
    expect(screen.queryByRole("tab", { name: "Thuốc" })).toBeNull();
  });
  it("ignores a stale response after the department changes, even if transport ignores abort", async () => {
    const service = api();
    let resolveOld!: (x: MedicalService[]) => void;
    vi.mocked(service.services)
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveOld = r;
          }),
      )
      .mockResolvedValueOnce([{ ...item, name: "Danh mục mới" }]);
    render(<CatalogPage api={service} />);
    await screen.findByRole("option", { name: "Khoa Ngoại" });
    fireEvent.change(screen.getByLabelText("Chuyên khoa"), {
      target: { value: "d2" },
    });
    await screen.findByText("Danh mục mới");
    resolveOld([{ ...item, name: "Dữ liệu cũ" }]);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("Dữ liệu cũ")).toBeNull();
  });
  it("reports fetch error and allows a manual retry", async () => {
    const service = api();
    vi.mocked(service.services).mockRejectedValueOnce(new Error("offline"));
    render(<CatalogPage api={service} />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await screen.findByText("Khám tổng quát");
  });
  it.each([
    [401, "UNAUTHENTICATED", "Phiên đăng nhập hết hạn"],
    [403, "FORBIDDEN", "quyền hiện tại không cho phép"],
  ] as const)(
    "shows protected API %i without retaining restricted rows",
    async (status, code, message) => {
      const service = api();
      vi.mocked(service.medicines).mockRejectedValueOnce(
        new ApiError(status, code, "Denied", "trace-1"),
      );
      render(
        <CatalogPage
          api={service}
          session={{ actorType: "DOCTOR", capabilities: [] }}
        />,
      );
      await screen.findByText("Khám tổng quát");
      fireEvent.click(screen.getByRole("tab", { name: "Thuốc" }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(message);
      expect(alert.textContent).toContain("trace-1");
    },
  );
  it("offers allowed staff lists and doctor handoff by catalog ID", async () => {
    const service = api();
    const choose = vi.fn();
    vi.mocked(service.doctors).mockResolvedValue({
      items: [
        {
          id: "doctor-catalog",
          departmentId: "d1",
          displayName: "BS. Minh",
          status: "ACTIVE",
        },
      ],
      total: 1,
    });
    render(
      <CatalogPage
        api={service}
        session={{ actorType: "DOCTOR", capabilities: [] }}
        onChooseDoctor={choose}
      />,
    );
    await screen.findByText("BS. Minh");
    fireEvent.click(screen.getByRole("button", { name: "Chọn BS. Minh" }));
    expect(choose).toHaveBeenCalledWith("doctor-catalog");
    fireEvent.click(screen.getByRole("tab", { name: "Xét nghiệm" }));
    await screen.findByText("Chưa có xét nghiệm phù hợp.");
  });
  it("preserves body, key and success feedback across a refreshed transport or lease", async () => {
    const first = api();
    vi.mocked(first.createPrice).mockRejectedValueOnce(
      new Error("response lost"),
    );
    const session = { actorType: "STAFF" as const, capabilities: ["ADMIN"] };
    const view = render(<CatalogPage api={first} session={session} />);
    await screen.findByRole("form", { name: "Tạo phiên bản giá" });
    fireEvent.change(screen.getByLabelText("Số tiền (VND)"), {
      target: { value: "150000" },
    });
    fireEvent.change(screen.getByLabelText("Hiệu lực từ"), {
      target: { value: "2030-01-01T09:00" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Tạo phiên bản giá" }));
    await screen.findByRole("alert");
    const second = api();
    view.rerender(<CatalogPage api={second} session={session} />);
    await screen.findByRole("form", { name: "Tạo phiên bản giá" });
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Số tiền (VND)") as HTMLInputElement).disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByLabelText("Số tiền (VND)") as HTMLInputElement).value,
    ).toBe("150000");
    fireEvent.submit(screen.getByRole("form", { name: "Tạo phiên bản giá" }));
    await waitFor(() => expect(second.createPrice).toHaveBeenCalledTimes(1));
    expect(vi.mocked(second.createPrice).mock.calls[0][1]).toBe(
      vi.mocked(first.createPrice).mock.calls[0][1],
    );
    await screen.findByText(/Đã tạo phiên bản giá/);
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Số tiền (VND)") as HTMLInputElement).disabled,
      ).toBe(false),
    );
    expect(screen.getByText(/Đã tạo phiên bản giá/)).toBeTruthy();
  });
});
describe("ADMIN price form", () => {
  const fill = () => {
    fireEvent.change(screen.getByLabelText("Số tiền (VND)"), {
      target: { value: "150000" },
    });
    fireEvent.change(screen.getByLabelText("Hiệu lực từ"), {
      target: { value: "2030-01-01T09:00" },
    });
  };
  it("blocks double submit, retries with the same key after an uncertain network result", async () => {
    const service = api();
    let reject!: (e: Error) => void;
    vi.mocked(service.createPrice).mockImplementationOnce(
      () =>
        new Promise((_, r) => {
          reject = r;
        }),
    );
    render(
      <PriceForm
        api={service}
        choices={[{ type: "EXAM", id: item.id, name: item.name }]}
        onSaved={() => {}}
      />,
    );
    fill();
    fireEvent.submit(screen.getByRole("form", { name: "Tạo phiên bản giá" }));
    fireEvent.submit(screen.getByRole("form", { name: "Tạo phiên bản giá" }));
    expect(service.createPrice).toHaveBeenCalledTimes(1);
    reject(new Error("offline"));
    await screen.findByRole("alert");
    fireEvent.submit(screen.getByRole("form", { name: "Tạo phiên bản giá" }));
    await screen.findByText(/Đã tạo phiên bản giá/);
    expect(vi.mocked(service.createPrice).mock.calls[0][1]).toBe(
      vi.mocked(service.createPrice).mock.calls[1][1],
    );
  });
  it("rejects unsafe amounts and invalid intervals before HTTP", async () => {
    const service = api();
    render(
      <PriceForm
        api={service}
        choices={[{ type: "EXAM", id: item.id, name: item.name }]}
        onSaved={() => {}}
      />,
    );
    fill();
    fireEvent.change(screen.getByLabelText("Số tiền (VND)"), {
      target: { value: "9007199254740992" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Tạo phiên bản giá" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(service.createPrice).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Số tiền (VND)"), {
      target: { value: "150000" },
    });
    fireEvent.change(screen.getByLabelText("Hiệu lực đến (không bắt buộc)"), {
      target: { value: "2029-12-31T09:00" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Tạo phiên bản giá" }));
    expect(service.createPrice).not.toHaveBeenCalled();
  });
  it.each(["committed", "not delivered"])(
    "retries unchanged intent after cutoff when first attempt was %s",
    async (outcome) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 9, 22, 9, 0));
      const service = api();
      vi.mocked(service.createPrice).mockRejectedValueOnce(
        new Error("response lost"),
      );
      if (outcome === "not delivered")
        vi.mocked(service.createPrice).mockRejectedValueOnce(
          new Error("server rejects too-late initial intent"),
        );
      render(
        <PriceForm
          api={service}
          choices={[{ type: "EXAM", id: item.id, name: item.name }]}
          onSaved={() => {}}
        />,
      );
      fireEvent.change(screen.getByLabelText("Số tiền (VND)"), {
        target: { value: "150000" },
      });
      fireEvent.submit(screen.getByRole("form", { name: "Tạo phiên bản giá" }));
      await screen.findByRole("alert");
      vi.setSystemTime(new Date(2026, 9, 22, 9, 11));
      fireEvent.submit(screen.getByRole("form", { name: "Tạo phiên bản giá" }));
      await waitFor(() => expect(service.createPrice).toHaveBeenCalledTimes(2));
      expect(vi.mocked(service.createPrice).mock.calls[0][1]).toBe(
        vi.mocked(service.createPrice).mock.calls[1][1],
      );
      if (outcome === "committed")
        await screen.findByText(/Đã tạo phiên bản giá/);
      else await screen.findByRole("alert");
      fireEvent.change(screen.getByLabelText("Số tiền (VND)"), {
        target: { value: "150001" },
      });
      fireEvent.submit(screen.getByRole("form", { name: "Tạo phiên bản giá" }));
      expect(service.createPrice).toHaveBeenCalledTimes(2); // Changed intent cannot bypass lead-time validation.
    },
  );
});

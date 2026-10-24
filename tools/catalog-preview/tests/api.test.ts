import { describe, expect, it, vi } from "vitest";
import {
  createCatalogApi,
  ApiError,
} from "../../../apps/web/src/features/catalog/api";
describe("Catalog contract adapter", () => {
  it("encodes filters, unwraps data, passes cancellation without owning auth", async () => {
    const transport = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { items: [], total: 0 },
          meta: { correlationId: "c" },
        }),
      ),
    );
    const controller = new AbortController();
    const api = createCatalogApi(transport);
    expect(await api.doctors("dept &1", 2, controller.signal)).toEqual({
      items: [],
      total: 0,
    });
    expect(transport.mock.calls[0][0]).toBe(
      "/api/v1/doctors?departmentId=dept+%261&page=2&limit=20",
    );
    expect(transport.mock.calls[0][1].signal).toBe(controller.signal);
  });
  it("retains machine error and correlation ID for a 409", async () => {
    const api = createCatalogApi(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "OVERLAPPING_PRICE_PERIOD", message: "Conflict" },
            meta: { correlationId: "c1" },
          }),
          { status: 409 },
        ),
    );
    await expect(
      api.createPrice(
        { itemType: "EXAM", itemId: "x", amountVnd: 0, effectiveFrom: "x" },
        "same-key",
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "OVERLAPPING_PRICE_PERIOD",
      correlationId: "c1",
    } satisfies Partial<ApiError>);
  });
});

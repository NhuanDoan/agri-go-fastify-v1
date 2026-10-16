import { describe, expect, it } from "vitest";
import { buildMeta, toOffset } from "../src/common/utils/pagination.js";
import { ok, paginated } from "../src/common/utils/response.js";

describe("envelope helpers", () => {
  it("ok wraps data", () => {
    expect(ok({ id: 1 }, "Created")).toEqual({
      success: true,
      message: "Created",
      data: { id: 1 },
    });
  });

  it("paginated carries meta", () => {
    const res = paginated([1, 2], buildMeta(2, 10, 25));
    expect(res.meta).toEqual({
      page: 2,
      perPage: 10,
      total: 25,
      totalPages: 3,
    });
  });

  it("computes offsets", () => {
    expect(toOffset(1, 15)).toBe(0);
    expect(toOffset(3, 15)).toBe(30);
  });
});

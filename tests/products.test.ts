import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { caller, createUser, resetDb, testConfig } from "./helpers.js";

let app: FastifyInstance;
const call = caller(() => app);
let admin: Awaited<ReturnType<typeof createUser>>;
let customer: Awaited<ReturnType<typeof createUser>>;
let categoryId: number;

beforeAll(async () => {
  app = await buildApp(testConfig());
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb(app.knex);
  admin = await createUser(app, { role: "admin" });
  customer = await createUser(app);
  categoryId = (
    await call("POST", "/api/categories", { name: "Fruit" }, admin.token)
  ).json().data.id;
});

const mk = async (over: Record<string, unknown> = {}) =>
  (
    await call(
      "POST",
      "/api/products",
      { categoryId, name: "Mango", price: 90000, quantity: 10, ...over },
      admin.token,
    )
  ).json().data;

const names = (res: { json: () => { data: { name: string }[] } }) =>
  res.json().data.map((p) => p.name);
const ledger = (productId: number) =>
  app
    .knex("inventory_histories")
    .where({ product_id: productId })
    .orderBy("id");

describe("create", () => {
  it("is admin only", async () => {
    const body = { categoryId, name: "X", price: 1 };
    expect((await call("POST", "/api/products", body)).statusCode).toBe(401);
    expect(
      (await call("POST", "/api/products", body, customer.token)).statusCode,
    ).toBe(403);
  });

  it("creates with defaults and nested category", async () => {
    const res = await call(
      "POST",
      "/api/products",
      { categoryId, name: "Xoài cát", price: 90000 },
      admin.token,
    );
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({
      name: "Xoài cát",
      slug: "xoai-cat",
      price: 90000,
      quantity: 0,
      unit: "kg",
      status: "active",
      category: { id: categoryId, name: "Fruit", slug: "fruit" },
    });
  });

  it("records initial stock in the ledger, and nothing for zero stock", async () => {
    const stocked = await mk({ quantity: 25 });
    const rows = await ledger(stocked.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      delta: 25,
      quantity_after: 25,
      reason: "import",
      created_by: admin.id,
    });

    const empty = await mk({ name: "Empty", quantity: 0 });
    expect(await ledger(empty.id)).toHaveLength(0);
  });

  it("keeps slugs unique for equal names", async () => {
    const a = await mk();
    const b = await mk();
    expect(a.slug).toBe("mango");
    expect(b.slug).toMatch(/^mango-[0-9a-f]{6}$/);
  });

  it("rejects an unknown category with 422", async () => {
    const res = await call(
      "POST",
      "/api/products",
      { categoryId: 9999, name: "X", price: 1 },
      admin.token,
    );
    expect(res.statusCode).toBe(422);
    expect(res.json().errors[0].field).toBe("categoryId");
  });

  it("validates price and stock", async () => {
    expect(
      (
        await call(
          "POST",
          "/api/products",
          { categoryId, name: "X", price: -1 },
          admin.token,
        )
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await call(
          "POST",
          "/api/products",
          { categoryId, name: "X", price: 1.5 },
          admin.token,
        )
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await call(
          "POST",
          "/api/products",
          { categoryId, name: "X", price: 1, quantity: -3 },
          admin.token,
        )
      ).statusCode,
    ).toBe(422);
  });
});

describe("visibility", () => {
  it("hides inactive products from anonymous users and customers, shows them to admins", async () => {
    await mk({ name: "Visible" });
    const hidden = await mk({ name: "Hidden", status: "inactive" });

    expect(names(await call("GET", "/api/products"))).toEqual(["Visible"]);
    expect(
      names(await call("GET", "/api/products", undefined, customer.token)),
    ).toEqual(["Visible"]);
    expect(
      names(await call("GET", "/api/products", undefined, admin.token)).sort(),
    ).toEqual(["Hidden", "Visible"]);

    expect((await call("GET", `/api/products/${hidden.id}`)).statusCode).toBe(
      404,
    );
    expect(
      (
        await call(
          "GET",
          `/api/products/${hidden.id}`,
          undefined,
          customer.token,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await call("GET", `/api/products/${hidden.id}`, undefined, admin.token))
        .statusCode,
    ).toBe(200);
  });

  it("ignores ?status=inactive from non-admins", async () => {
    await mk({ name: "Visible" });
    await mk({ name: "Hidden", status: "inactive" });
    expect(names(await call("GET", "/api/products?status=inactive"))).toEqual([
      "Visible",
    ]);
    expect(
      names(
        await call(
          "GET",
          "/api/products?status=inactive",
          undefined,
          admin.token,
        ),
      ),
    ).toEqual(["Hidden"]);
  });

  it("answers 401 when a token is sent but invalid", async () => {
    expect(
      (await call("GET", "/api/products", undefined, "garbage")).statusCode,
    ).toBe(401);
  });
});

describe("search, filter, sort, paginate", () => {
  beforeEach(async () => {
    const veg = (
      await call("POST", "/api/categories", { name: "Veg" }, admin.token)
    ).json().data.id;
    await mk({ name: "Mango", price: 90000 });
    await mk({ name: "Mandarin", price: 30000 });
    await mk({ name: "Carrot", price: 10000, categoryId: veg });
  });

  it("sorts names case-insensitively with a stable tie-breaker", async () => {
    await mk({ name: "Banana" });
    await mk({ name: "apple" });
    await mk({ name: "Cherry" });
    await mk({ name: "APPLE" });

    const res = await call("GET", "/api/products?sort=name");

    expect(res.statusCode).toBe(200);
    expect(names(res)).toEqual([
      "apple",
      "APPLE",
      "Banana",
      "Carrot",
      "Cherry",
      "Mandarin",
      "Mango",
    ]);
  });

  it("filters by category and price range", async () => {
    const veg = (await call("GET", "/api/categories?q=veg")).json().data[0].id;
    expect(names(await call("GET", `/api/products?categoryId=${veg}`))).toEqual(
      ["Carrot"],
    );
    expect(
      names(await call("GET", "/api/products?minPrice=20000&maxPrice=50000")),
    ).toEqual(["Mandarin"]);
  });

  it("sorts", async () => {
    expect(names(await call("GET", "/api/products?sort=price_asc"))).toEqual([
      "Carrot",
      "Mandarin",
      "Mango",
    ]);
    expect(names(await call("GET", "/api/products?sort=price_desc"))).toEqual([
      "Mango",
      "Mandarin",
      "Carrot",
    ]);
    expect(names(await call("GET", "/api/products?sort=name"))).toEqual([
      "Carrot",
      "Mandarin",
      "Mango",
    ]);
  });

  it("paginates with meta", async () => {
    const res = await call(
      "GET",
      "/api/products?perPage=2&page=2&sort=price_asc",
    );
    expect(res.json().meta).toEqual({
      page: 2,
      perPage: 2,
      total: 3,
      totalPages: 2,
    });
    expect(names(res)).toEqual(["Mango"]);
  });

  it("rejects out-of-range paging and unknown sorts", async () => {
    expect((await call("GET", "/api/products?perPage=1000")).statusCode).toBe(
      422,
    );
    expect((await call("GET", "/api/products?page=0")).statusCode).toBe(422);
    expect((await call("GET", "/api/products?sort=cheapest")).statusCode).toBe(
      422,
    );
  });

  it("sorts names case-insensitively", async () => {
    await mk({ name: "apple" });
    await mk({ name: "Banana" });
    expect(names(await call("GET", "/api/products?sort=name"))).toEqual([
      "apple",
      "Banana",
      "Carrot",
      "Mandarin",
      "Mango",
    ]);
  });
});

describe("update", () => {
  it("changes fields but the slug stays stable", async () => {
    const p = await mk();
    const res = await call(
      "PUT",
      `/api/products/${p.id}`,
      { name: "Mango Premium", price: 120000 },
      admin.token,
    );
    expect(res.json().data).toMatchObject({
      name: "Mango Premium",
      price: 120000,
      slug: "mango",
    });
  });

  it("cannot change stock through the generic update (the field is ignored)", async () => {
    const p = await mk({ quantity: 10 });
    const res = await call(
      "PUT",
      `/api/products/${p.id}`,
      { price: 5000, quantity: 999 },
      admin.token,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ price: 5000, quantity: 10 });
    expect(await ledger(p.id)).toHaveLength(1); // only the initial import
  });

  it("moves a product to another category and validates it", async () => {
    const p = await mk();
    expect(
      (
        await call(
          "PUT",
          `/api/products/${p.id}`,
          { categoryId: 9999 },
          admin.token,
        )
      ).statusCode,
    ).toBe(422);
  });

  it("answers 404 for a missing product and 403 for customers", async () => {
    expect(
      (await call("PUT", "/api/products/99999", { price: 1 }, admin.token))
        .statusCode,
    ).toBe(404);
    const p = await mk();
    expect(
      (await call("PUT", `/api/products/${p.id}`, { price: 1 }, customer.token))
        .statusCode,
    ).toBe(403);
  });

  it("activates and deactivates", async () => {
    const p = await mk();
    await call(
      "PATCH",
      `/api/products/${p.id}/status`,
      { status: "inactive" },
      admin.token,
    );
    expect((await call("GET", `/api/products/${p.id}`)).statusCode).toBe(404);
    await call(
      "PATCH",
      `/api/products/${p.id}/status`,
      { status: "active" },
      admin.token,
    );
    expect((await call("GET", `/api/products/${p.id}`)).statusCode).toBe(200);
  });
});

describe("stock changes and the ledger", () => {
  it("records the signed delta, the balance and the reason", async () => {
    const p = await mk({ quantity: 10 });
    const res = await call(
      "PATCH",
      `/api/products/${p.id}/quantity`,
      { quantity: 4, notes: "spoiled" },
      admin.token,
    );
    expect(res.json().data.quantity).toBe(4);

    const rows = await ledger(p.id);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      delta: -6,
      quantity_after: 4,
      reason: "adjustment",
      notes: "spoiled",
      created_by: admin.id,
    });
  });

  it("labels a restock from zero as an import", async () => {
    const p = await mk({ quantity: 3 });
    await call(
      "PATCH",
      `/api/products/${p.id}/quantity`,
      { quantity: 0 },
      admin.token,
    );
    await call(
      "PATCH",
      `/api/products/${p.id}/quantity`,
      { quantity: 50 },
      admin.token,
    );
    const rows = await ledger(p.id);
    expect(rows.map((r) => r.reason)).toEqual([
      "import",
      "adjustment",
      "import",
    ]);
    expect(rows[2]).toMatchObject({ delta: 50, quantity_after: 50 });
  });

  it("writes nothing when the quantity did not change", async () => {
    const p = await mk({ quantity: 10 });
    await call(
      "PATCH",
      `/api/products/${p.id}/quantity`,
      { quantity: 10 },
      admin.token,
    );
    expect(await ledger(p.id)).toHaveLength(1);
  });

  it("refuses negative stock and unknown products", async () => {
    const p = await mk();
    expect(
      (
        await call(
          "PATCH",
          `/api/products/${p.id}/quantity`,
          { quantity: -1 },
          admin.token,
        )
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await call(
          "PATCH",
          "/api/products/99999/quantity",
          { quantity: 1 },
          admin.token,
        )
      ).statusCode,
    ).toBe(404);
  });

  it("keeps the ledger balance equal to the product stock after many changes", async () => {
    const p = await mk({ quantity: 10 });
    for (const q of [3, 8, 0, 5])
      await call(
        "PATCH",
        `/api/products/${p.id}/quantity`,
        { quantity: q },
        admin.token,
      );
    const rows = await ledger(p.id);
    const sum = rows.reduce((n, r) => n + r.delta, 0);
    expect(sum).toBe(5);
    expect(rows.at(-1)?.quantity_after).toBe(5);
  });

  it("exposes the ledger to admins only, filterable by product", async () => {
    const a = await mk({ name: "A", quantity: 5 });
    await mk({ name: "B", quantity: 7 });
    expect((await call("GET", "/api/inventory-histories")).statusCode).toBe(
      401,
    );
    expect(
      (await call("GET", "/api/inventory-histories", undefined, customer.token))
        .statusCode,
    ).toBe(403);

    const all = await call(
      "GET",
      "/api/inventory-histories",
      undefined,
      admin.token,
    );
    expect(all.json().meta.total).toBe(2);
    const one = await call(
      "GET",
      `/api/inventory-histories?productId=${a.id}`,
      undefined,
      admin.token,
    );
    expect(one.json().data).toHaveLength(1);
    expect(one.json().data[0]).toMatchObject({
      productId: a.id,
      delta: 5,
      quantityAfter: 5,
      reason: "import",
    });
  });
});

describe("soft delete", () => {
  it("hides the product everywhere but keeps the row", async () => {
    const p = await mk();
    expect(
      (await call("DELETE", `/api/products/${p.id}`, undefined, admin.token))
        .statusCode,
    ).toBe(200);

    expect(
      (await call("GET", `/api/products/${p.id}`, undefined, admin.token))
        .statusCode,
    ).toBe(404);
    expect(
      names(await call("GET", "/api/products", undefined, admin.token)),
    ).toEqual([]);
    expect(
      (
        await call(
          "PATCH",
          `/api/products/${p.id}/quantity`,
          { quantity: 1 },
          admin.token,
        )
      ).statusCode,
    ).toBe(404);

    const row = await app.knex("products").where({ id: p.id }).first();
    expect(row.deleted_at).not.toBeNull();
    expect(row.status).toBe("inactive");
  });

  it("does not reuse the slug of a deleted product", async () => {
    const p = await mk();
    await call("DELETE", `/api/products/${p.id}`, undefined, admin.token);
    const again = await mk();
    expect(again.slug).not.toBe("mango");
  });

  it("answers 404 when deleting twice", async () => {
    const p = await mk();
    await call("DELETE", `/api/products/${p.id}`, undefined, admin.token);
    expect(
      (await call("DELETE", `/api/products/${p.id}`, undefined, admin.token))
        .statusCode,
    ).toBe(404);
  });
});

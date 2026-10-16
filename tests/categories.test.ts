import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { caller, createUser, resetDb, testConfig } from "./helpers.js";

let app: FastifyInstance;
const call = caller(() => app);
let admin: Awaited<ReturnType<typeof createUser>>;
let customer: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  app = await buildApp(testConfig());
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb(app.knex);
  admin = await createUser(app, { role: "admin" });
  customer = await createUser(app);
});

const create = (name: string, extra: Record<string, unknown> = {}) =>
  call("POST", "/api/categories", { name, ...extra }, admin.token);

describe("categories", () => {
  it("lets anyone read, only admins write", async () => {
    expect((await call("GET", "/api/categories")).statusCode).toBe(200);
    expect(
      (await call("POST", "/api/categories", { name: "X" })).statusCode,
    ).toBe(401);
    expect(
      (await call("POST", "/api/categories", { name: "X" }, customer.token))
        .statusCode,
    ).toBe(403);
    expect((await create("X")).statusCode).toBe(201);
  });

  it("builds the slug from the name (Vietnamese aware)", async () => {
    const res = await create("Rau củ quả", { description: "Tươi mỗi ngày" });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({
      name: "Rau củ quả",
      slug: "rau-cu-qua",
      description: "Tươi mỗi ngày",
    });
  });

  it("rejects a duplicate name, in any case", async () => {
    await create("Fruit");
    expect((await create("fruit")).statusCode).toBe(409);
  });

  it("rejects a different name that produces the same slug", async () => {
    await create("Rau củ quả");
    expect((await create("Rau cu qua")).statusCode).toBe(409);
  });

  it("validates input", async () => {
    expect((await create("")).statusCode).toBe(422);
    expect(
      (await call("POST", "/api/categories", {}, admin.token)).statusCode,
    ).toBe(422);
  });

  it("lists alphabetically, searches case-insensitively, and paginates", async () => {
    for (const n of ["Banana", "apple", "Cherry"]) await create(n);
    const all = await call("GET", "/api/categories");
    expect(all.json().data.map((c: { name: string }) => c.name)).toEqual([
      "apple",
      "Banana",
      "Cherry",
    ]);

    const found = await call("GET", "/api/categories?q=ANA");
    expect(found.json().data.map((c: { name: string }) => c.name)).toEqual([
      "Banana",
    ]);

    const page = await call("GET", "/api/categories?perPage=2&page=2");
    expect(page.json().meta).toEqual({
      page: 2,
      perPage: 2,
      total: 3,
      totalPages: 2,
    });
    expect(page.json().data).toHaveLength(1);
  });

  it("gets one, 404 when missing, 422 for a bad id", async () => {
    const id = (await create("Fruit")).json().data.id;
    expect((await call("GET", `/api/categories/${id}`)).json().data.name).toBe(
      "Fruit",
    );
    expect((await call("GET", "/api/categories/99999")).statusCode).toBe(404);
    expect((await call("GET", "/api/categories/abc")).statusCode).toBe(422);
  });

  it("renaming regenerates the slug; null clears the description", async () => {
    const id = (await create("Fruit", { description: "Sweet" })).json().data.id;
    const res = await call(
      "PUT",
      `/api/categories/${id}`,
      { name: "Trái cây", description: null },
      admin.token,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      name: "Trái cây",
      slug: "trai-cay",
      description: null,
    });
  });

  it("keeping the same name on update is not a conflict", async () => {
    const id = (await create("Fruit")).json().data.id;
    expect(
      (
        await call(
          "PUT",
          `/api/categories/${id}`,
          { name: "Fruit", description: "x" },
          admin.token,
        )
      ).statusCode,
    ).toBe(200);
  });

  it("refuses to rename onto another category", async () => {
    await create("Fruit");
    const id = (await create("Veg")).json().data.id;
    expect(
      (
        await call(
          "PUT",
          `/api/categories/${id}`,
          { name: "fruit" },
          admin.token,
        )
      ).statusCode,
    ).toBe(409);
  });

  it("deletes an empty category", async () => {
    const id = (await create("Fruit")).json().data.id;
    expect(
      (await call("DELETE", `/api/categories/${id}`, undefined, admin.token))
        .statusCode,
    ).toBe(200);
    expect((await call("GET", `/api/categories/${id}`)).statusCode).toBe(404);
  });

  it("refuses to delete a category that has products, even soft-deleted ones", async () => {
    const id = (await create("Fruit")).json().data.id;
    const product = await call(
      "POST",
      "/api/products",
      { categoryId: id, name: "Mango", price: 1000 },
      admin.token,
    );
    expect(
      (await call("DELETE", `/api/categories/${id}`, undefined, admin.token))
        .statusCode,
    ).toBe(409);

    await call(
      "DELETE",
      `/api/products/${product.json().data.id}`,
      undefined,
      admin.token,
    ); // soft delete
    expect(
      (await call("DELETE", `/api/categories/${id}`, undefined, admin.token))
        .statusCode,
    ).toBe(409);
  });
});

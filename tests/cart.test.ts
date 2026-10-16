import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { caller, createUser, resetDb, testConfig } from "./helpers.js";

let app: FastifyInstance;
const call = caller(() => app);
type User = Awaited<ReturnType<typeof createUser>>;
let admin: User;
let customer: User;
let categoryId: number;
let mango: { id: number };
let carrot: { id: number };

beforeAll(async () => {
  app = await buildApp(testConfig());
});
afterAll(() => app.close());

async function mk(name: string, price: number, quantity: number) {
  return (
    await call(
      "POST",
      "/api/products",
      { categoryId, name, price, quantity },
      admin.token,
    )
  ).json().data;
}

beforeEach(async () => {
  await resetDb(app.knex);
  admin = await createUser(app, { role: "admin" });
  customer = await createUser(app);
  categoryId = (
    await call("POST", "/api/categories", { name: "Fruit" }, admin.token)
  ).json().data.id;
  mango = await mk("Mango", 90000, 10);
  carrot = await mk("Carrot", 10000, 5);
});

const add = (productId: number, quantity: number, token = customer.token) =>
  call("POST", "/api/cart/items", { productId, quantity }, token);
const cart = async (token = customer.token) =>
  (await call("GET", "/api/cart", undefined, token)).json().data;

describe("cart", () => {
  it("requires a login", async () => {
    expect((await call("GET", "/api/cart")).statusCode).toBe(401);
    expect(
      (await call("POST", "/api/cart/items", { productId: 1, quantity: 1 }))
        .statusCode,
    ).toBe(401);
  });

  it("starts empty and is created lazily", async () => {
    expect(await app.knex("carts")).toHaveLength(0);
    expect(await cart()).toMatchObject({
      items: [],
      totalItems: 0,
      subtotal: 0,
    });
    expect(await app.knex("carts")).toHaveLength(1);
  });

  it("adds items, accumulates repeats, and totals correctly", async () => {
    await add(mango.id, 2);
    await add(carrot.id, 3);
    await add(mango.id, 1); // 2 + 1
    const c = await cart();
    expect(c.items).toEqual([
      {
        productId: mango.id,
        name: "Mango",
        unit: "kg",
        price: 90000,
        quantity: 3,
        subtotal: 270000,
        stock: 10,
        available: true,
      },
      {
        productId: carrot.id,
        name: "Carrot",
        unit: "kg",
        price: 10000,
        quantity: 3,
        subtotal: 30000,
        stock: 5,
        available: true,
      },
    ]);
    expect(c).toMatchObject({ totalItems: 6, subtotal: 300000 });
  });

  it("refuses more than the stock, and a refused add leaves the cart unchanged", async () => {
    await add(carrot.id, 4);
    const res = await add(carrot.id, 2); // 4 + 2 > 5
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toBe("Only 5 kg left in stock");
    expect((await cart()).items[0].quantity).toBe(4);
  });

  it("refuses unknown, inactive and deleted products with 404", async () => {
    expect((await add(99999, 1)).statusCode).toBe(404);

    await call(
      "PATCH",
      `/api/products/${mango.id}/status`,
      { status: "inactive" },
      admin.token,
    );
    expect((await add(mango.id, 1)).statusCode).toBe(404);

    await call("DELETE", `/api/products/${carrot.id}`, undefined, admin.token);
    expect((await add(carrot.id, 1)).statusCode).toBe(404);
  });

  it("validates quantities", async () => {
    expect((await add(mango.id, 0)).statusCode).toBe(422);
    expect((await add(mango.id, -1)).statusCode).toBe(422);
    expect((await add(mango.id, 1.5)).statusCode).toBe(422);
    expect((await add(mango.id, 5000)).statusCode).toBe(422);
  });

  it("sets an exact quantity, within stock", async () => {
    await add(mango.id, 1);
    const res = await call(
      "PUT",
      `/api/cart/items/${mango.id}`,
      { quantity: 7 },
      customer.token,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().data.items[0].quantity).toBe(7);

    expect(
      (
        await call(
          "PUT",
          `/api/cart/items/${mango.id}`,
          { quantity: 11 },
          customer.token,
        )
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await call(
          "PUT",
          `/api/cart/items/${mango.id}`,
          { quantity: 0 },
          customer.token,
        )
      ).statusCode,
    ).toBe(422);
  });

  it("answers 404 when setting an item that is not in the cart", async () => {
    expect(
      (
        await call(
          "PUT",
          `/api/cart/items/${mango.id}`,
          { quantity: 1 },
          customer.token,
        )
      ).statusCode,
    ).toBe(404);
  });

  it("removes one item and clears the rest", async () => {
    await add(mango.id, 1);
    await add(carrot.id, 1);
    await call(
      "DELETE",
      `/api/cart/items/${mango.id}`,
      undefined,
      customer.token,
    );
    expect(
      (await cart()).items.map((i: { productId: number }) => i.productId),
    ).toEqual([carrot.id]);

    await call("DELETE", "/api/cart", undefined, customer.token);
    expect((await cart()).items).toEqual([]);
  });

  it("is private: another user sees their own empty cart", async () => {
    const other = await createUser(app, { email: "other@example.com" });
    await add(mango.id, 2);
    expect((await cart(other.token)).items).toEqual([]);
    expect((await cart()).items).toHaveLength(1);
  });

  it("shows the CURRENT price (a cart is not a price promise)", async () => {
    await add(mango.id, 2);
    await call(
      "PUT",
      `/api/products/${mango.id}`,
      { price: 100000 },
      admin.token,
    );
    expect(await cart()).toMatchObject({ subtotal: 200000 });
  });

  it("marks items unavailable when the product is deactivated, deleted or short on stock", async () => {
    await add(mango.id, 2);
    await add(carrot.id, 4);

    await call(
      "PATCH",
      `/api/products/${mango.id}/status`,
      { status: "inactive" },
      admin.token,
    );
    await call(
      "PATCH",
      `/api/products/${carrot.id}/quantity`,
      { quantity: 1 },
      admin.token,
    ); // less than the 4 in the cart

    const c = await cart();
    expect(c.items.map((i: { available: boolean }) => i.available)).toEqual([
      false,
      false,
    ]);
    expect(c.subtotal).toBe(0); // unavailable lines are not counted

    await call("DELETE", `/api/products/${mango.id}`, undefined, admin.token);
    expect((await cart()).items).toHaveLength(2); // still listed, so the customer can see and remove it
  });

  it("creates exactly one cart when the first requests arrive together", async () => {
    const results = await Promise.all(
      [1, 2, 3, 4].map(() =>
        call("GET", "/api/cart", undefined, customer.token),
      ),
    );
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
    expect(
      await app.knex("carts").where({ user_id: customer.id }),
    ).toHaveLength(1);
  });
});

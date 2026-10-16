import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  caller,
  completePurchase,
  createUser,
  resetDb,
  testConfig,
} from "./helpers.js";

let app: FastifyInstance;
const call = caller(() => app);
type User = Awaited<ReturnType<typeof createUser>>;
let admin: User;
let customer: User;
let mango: { id: number };

beforeAll(async () => {
  app = await buildApp(testConfig());
});
afterAll(() => app.close());

beforeEach(async () => {
  await resetDb(app.knex);
  admin = await createUser(app, { role: "admin" });
  customer = await createUser(app);
  const categoryId = (
    await call("POST", "/api/categories", { name: "Fruit" }, admin.token)
  ).json().data.id;
  mango = (
    await call(
      "POST",
      "/api/products",
      { categoryId, name: "Mango", price: 90000, quantity: 100 },
      admin.token,
    )
  ).json().data;
});

const review = (
  productId: number,
  body: Record<string, unknown>,
  token = customer.token,
) => call("POST", `/api/products/${productId}/reviews`, body, token);

/** A new customer who bought the mango, optionally already reviewing it. */
async function buyer(email: string, rating?: number) {
  const user = await createUser(app, { email });
  await completePurchase(app, admin, user, mango.id);
  if (rating)
    await review(mango.id, { rating, comment: `rated ${rating}` }, user.token);
  return user;
}

describe("who may review", () => {
  it("requires a login", async () => {
    expect(
      (await call("POST", `/api/products/${mango.id}/reviews`, { rating: 5 }))
        .statusCode,
    ).toBe(401);
  });

  it("refuses customers who never bought the product", async () => {
    const res = await review(mango.id, { rating: 5 });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/received this product/);
  });

  it("refuses an order that is not completed yet", async () => {
    await call(
      "POST",
      "/api/orders/buy-now",
      {
        productId: mango.id,
        quantity: 1,
        paymentMethod: "cod",
        shipping: { phone: "0901234567", address: "1 Le Loi, HCMC" },
      },
      customer.token,
    );
    expect((await review(mango.id, { rating: 5 })).statusCode).toBe(403);
  });

  it("refuses a cancelled order", async () => {
    const id = (
      await call(
        "POST",
        "/api/orders/buy-now",
        {
          productId: mango.id,
          quantity: 1,
          paymentMethod: "cod",
          shipping: { phone: "0901234567", address: "1 Le Loi, HCMC" },
        },
        customer.token,
      )
    ).json().data.order.id;
    await call("POST", `/api/orders/${id}/cancel`, {}, customer.token);
    expect((await review(mango.id, { rating: 5 })).statusCode).toBe(403);
  });

  it("accepts a customer with a completed order", async () => {
    await completePurchase(app, admin, customer, mango.id);
    const res = await review(mango.id, {
      rating: 4,
      comment: "  Sweet and fresh  ",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({
      rating: 4,
      comment: "Sweet and fresh", // trimmed
      user: { id: customer.id, fullName: "Test User", avatarUrl: null },
    });
  });

  it("never exposes the author's email", async () => {
    await completePurchase(app, admin, customer, mango.id);
    const created = await review(mango.id, { rating: 5 });
    expect(created.body).not.toContain(customer.email);
    const listed = await call("GET", `/api/products/${mango.id}/reviews`);
    expect(listed.body).not.toContain(customer.email);
  });

  it("only counts a purchase of THAT product", async () => {
    const categoryId = (await call("GET", "/api/categories")).json().data[0].id;
    const carrot = (
      await call(
        "POST",
        "/api/products",
        { categoryId, name: "Carrot", price: 1000, quantity: 5 },
        admin.token,
      )
    ).json().data;
    await completePurchase(app, admin, customer, carrot.id);
    expect((await review(mango.id, { rating: 5 })).statusCode).toBe(403);
    expect((await review(carrot.id, { rating: 5 })).statusCode).toBe(201);
  });
});

describe("creating a review", () => {
  beforeEach(() => completePurchase(app, admin, customer, mango.id));

  it("allows one review per product, with a friendly 409", async () => {
    expect((await review(mango.id, { rating: 5 })).statusCode).toBe(201);
    const again = await review(mango.id, { rating: 1 });
    expect(again.statusCode).toBe(409);
    expect(again.json().message).toMatch(/already reviewed/);
  });

  it("lets exactly one of two simultaneous reviews win (unique index)", async () => {
    const results = await Promise.all([
      review(mango.id, { rating: 5 }),
      review(mango.id, { rating: 4 }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(
      await app.knex("reviews").where({ user_id: customer.id }),
    ).toHaveLength(1);
  });

  it("validates the rating and comment", async () => {
    for (const rating of [0, 6, -1, 3.5, "5x"])
      expect((await review(mango.id, { rating })).statusCode).toBe(422);
    expect((await review(mango.id, {})).statusCode).toBe(422);
    expect(
      (await review(mango.id, { rating: 5, comment: "x".repeat(2001) }))
        .statusCode,
    ).toBe(422);
    expect(
      (await review(mango.id, { rating: 5, extra: true })).statusCode,
    ).toBe(201); // unknown fields are dropped
  });

  it("stores a blank comment as null", async () => {
    expect(
      (await review(mango.id, { rating: 5, comment: "   " })).json().data
        .comment,
    ).toBeNull();
  });

  it("answers 404 for unknown, inactive and deleted products", async () => {
    expect((await review(99999, { rating: 5 })).statusCode).toBe(404);
    await call(
      "PATCH",
      `/api/products/${mango.id}/status`,
      { status: "inactive" },
      admin.token,
    );
    expect((await review(mango.id, { rating: 5 })).statusCode).toBe(404);
    await call("DELETE", `/api/products/${mango.id}`, undefined, admin.token);
    expect((await review(mango.id, { rating: 5 })).statusCode).toBe(404);
  });
});

describe("reading reviews", () => {
  it("lists newest first with pagination, publicly", async () => {
    await buyer("a@example.com", 5);
    await buyer("b@example.com", 4);
    await buyer("c@example.com", 3);

    const res = await call(
      "GET",
      `/api/products/${mango.id}/reviews?perPage=2`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().meta).toEqual({
      page: 1,
      perPage: 2,
      total: 3,
      totalPages: 2,
    });
    expect(res.json().data.map((r: { rating: number }) => r.rating)).toEqual([
      3, 4,
    ]);

    const page2 = await call(
      "GET",
      `/api/products/${mango.id}/reviews?perPage=2&page=2`,
    );
    expect(page2.json().data.map((r: { rating: number }) => r.rating)).toEqual([
      5,
    ]);
  });

  it("only shows reviews of that product", async () => {
    await buyer("a@example.com", 5);
    const categoryId = (await call("GET", "/api/categories")).json().data[0].id;
    const other = (
      await call(
        "POST",
        "/api/products",
        { categoryId, name: "Other", price: 1000, quantity: 5 },
        admin.token,
      )
    ).json().data;
    expect(
      (await call("GET", `/api/products/${other.id}/reviews`)).json().meta
        .total,
    ).toBe(0);
  });

  it("hides the reviews of inactive products from the public but not from admins", async () => {
    await buyer("a@example.com", 5);
    await call(
      "PATCH",
      `/api/products/${mango.id}/status`,
      { status: "inactive" },
      admin.token,
    );
    expect(
      (await call("GET", `/api/products/${mango.id}/reviews`)).statusCode,
    ).toBe(404);
    expect(
      (
        await call(
          "GET",
          `/api/products/${mango.id}/reviews`,
          undefined,
          customer.token,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call(
          "GET",
          `/api/products/${mango.id}/reviews`,
          undefined,
          admin.token,
        )
      ).json().meta.total,
    ).toBe(1);
    expect(
      (await call("GET", `/api/products/${mango.id}/reviews/summary`))
        .statusCode,
    ).toBe(404);
  });

  it("answers 404 for a deleted product and 422 for a bad id", async () => {
    await call("DELETE", `/api/products/${mango.id}`, undefined, admin.token);
    expect(
      (await call("GET", `/api/products/${mango.id}/reviews`)).statusCode,
    ).toBe(404);
    expect((await call("GET", "/api/products/abc/reviews")).statusCode).toBe(
      422,
    );
  });

  it("summarises an unreviewed product with zeros and a null average", async () => {
    const res = await call("GET", `/api/products/${mango.id}/reviews/summary`);
    expect(res.json().data).toEqual({
      count: 0,
      average: null,
      distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
    });
  });

  it("computes the average (one decimal) and the distribution", async () => {
    await buyer("a@example.com", 5);
    await buyer("b@example.com", 4);
    await buyer("c@example.com", 4);
    const res = await call("GET", `/api/products/${mango.id}/reviews/summary`);
    expect(res.json().data).toEqual({
      count: 3,
      average: 4.3,
      distribution: { "1": 0, "2": 0, "3": 0, "4": 2, "5": 1 },
    });
  });
});

describe("editing and deleting", () => {
  let reviewId: number;
  beforeEach(async () => {
    await completePurchase(app, admin, customer, mango.id);
    reviewId = (await review(mango.id, { rating: 3, comment: "ok" })).json()
      .data.id;
  });

  const edit = (body: Record<string, unknown>, token = customer.token) =>
    call("PUT", `/api/reviews/${reviewId}`, body, token);

  it("lets the author change the rating and the comment independently", async () => {
    expect((await edit({ rating: 5 })).json().data).toMatchObject({
      rating: 5,
      comment: "ok",
    });
    expect((await edit({ comment: "much better" })).json().data).toMatchObject({
      rating: 5,
      comment: "much better",
    });
    expect((await edit({ comment: null })).json().data.comment).toBeNull();
  });

  it("validates edits", async () => {
    expect((await edit({ rating: 9 })).statusCode).toBe(422);
  });

  it("keeps everyone else out, admins included", async () => {
    const other = await createUser(app, { email: "other@example.com" });
    expect((await edit({ rating: 1 }, other.token)).statusCode).toBe(403);
    expect((await edit({ rating: 1 }, admin.token)).statusCode).toBe(403);
    expect(
      (await call("PUT", `/api/reviews/${reviewId}`, { rating: 1 })).statusCode,
    ).toBe(401);
    expect(
      (await call("PUT", "/api/reviews/99999", { rating: 1 }, customer.token))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.knex("reviews").where({ id: reviewId }).first()).rating,
    ).toBe(3);
  });

  it("lets the author delete, and then review again", async () => {
    expect(
      (
        await call(
          "DELETE",
          `/api/reviews/${reviewId}`,
          undefined,
          customer.token,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await call("GET", `/api/products/${mango.id}/reviews`)).json().meta
        .total,
    ).toBe(0);
    expect((await review(mango.id, { rating: 5 })).statusCode).toBe(201);
  });

  it("lets an admin delete any review, but not another customer", async () => {
    const other = await createUser(app, { email: "other@example.com" });
    expect(
      (await call("DELETE", `/api/reviews/${reviewId}`, undefined, other.token))
        .statusCode,
    ).toBe(403);
    expect(
      (await call("DELETE", `/api/reviews/${reviewId}`, undefined, admin.token))
        .statusCode,
    ).toBe(200);
    expect(
      (await call("DELETE", `/api/reviews/${reviewId}`, undefined, admin.token))
        .statusCode,
    ).toBe(404);
  });

  it("is removed together with its author", async () => {
    expect(
      (
        await call(
          "DELETE",
          `/api/users/${customer.id}`,
          undefined,
          admin.token,
        )
      ).statusCode,
    ).toBe(409); // has orders
    // ...but a user without orders can be deleted, and a review can never outlive its author:
    await app
      .knex("reviews")
      .update({
        user_id: (await createUser(app, { email: "tmp@example.com" })).id,
      });
    const tmp = await app
      .knex("users")
      .where({ email: "tmp@example.com" })
      .first();
    await call("DELETE", `/api/users/${tmp.id}`, undefined, admin.token);
    expect(await app.knex("reviews")).toHaveLength(0);
  });
});

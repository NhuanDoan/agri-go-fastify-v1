import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import {
  CaptureTransport,
  caller,
  createUser,
  flushMail,
  resetDb,
  testConfig,
} from "./helpers.js";

let app: FastifyInstance;
const transport = new CaptureTransport();
const call = caller(() => app);
type User = Awaited<ReturnType<typeof createUser>>;
let admin: User;
let mango: { id: number };

beforeAll(async () => {
  app = await buildApp(testConfig(), { mailTransport: transport });
});
afterAll(() => app.close());

beforeEach(async () => {
  await resetDb(app.knex);
  transport.reset();
  admin = await createUser(app, { role: "admin" });
  const categoryId = (
    await call("POST", "/api/categories", { name: "Fruit" }, admin.token)
  ).json().data.id;
  mango = (
    await call(
      "POST",
      "/api/products",
      { categoryId, name: "Mango", price: 90000, quantity: 10 },
      admin.token,
    )
  ).json().data;
});

const shipping = {
  receiverName: "Nguyen Van A",
  phone: "0901234567",
  address: "1 Le Loi, District 1, HCMC",
};
const email = "new@example.com";

/** A new public registration starts unverified. */
async function newcomer() {
  const reg = await call("POST", "/api/auth/register", {
    fullName: "New Customer",
    email,
    password: "Secret123!",
  });
  expect(reg.json().data.user.emailVerifiedAt).toBeNull();
  return {
    id: reg.json().data.user.id as number,
    token: reg.json().data.tokens.accessToken as string,
  };
}

const stock = async () =>
  (await app.knex("products").where({ id: mango.id }).first())
    .quantity as number;
const checkout = (token: string) =>
  call("POST", "/api/orders/checkout", { paymentMethod: "cod", shipping }, token);
const addToCart = (token: string) =>
  call("POST", "/api/cart/items", { productId: mango.id, quantity: 2 }, token);

describe("unverified account access", () => {
  it("can log in, browse, fill a cart, edit profile, and contact support", async () => {
    const { token } = await newcomer();
    expect(
      (
        await call("POST", "/api/auth/login", {
          email,
          password: "Secret123!",
        })
      ).statusCode,
    ).toBe(200);
    expect((await call("GET", "/api/products")).statusCode).toBe(200);
    expect((await addToCart(token)).statusCode).toBe(200);
    expect(
      (await call("PUT", "/api/me", { phone: "0901234567" }, token))
        .statusCode,
    ).toBe(200);

    const room = (
      await call("POST", "/api/chat/rooms/me", undefined, token)
    ).json().data;
    expect(
      (
        await call(
          "POST",
          `/api/chat/rooms/${room.id}/messages`,
          { message: "My code never arrived" },
          token,
        )
      ).statusCode,
    ).toBe(201);
  });
});

describe("unverified accounts cannot place orders", () => {
  it("refuses checkout without reserving stock or changing the cart", async () => {
    const { token } = await newcomer();
    await addToCart(token);

    const res = await checkout(token);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      success: false,
      code: "EMAIL_NOT_VERIFIED",
      message: "Verify your email address before placing an order",
    });
    expect(res.json().requestId).toEqual(expect.any(String));
    expect(await stock()).toBe(10);
    expect(await app.knex("orders")).toHaveLength(0);
    expect(await app.knex("mail_outbox").where({ type: "order_placed" })).toHaveLength(0);
    expect(
      (await call("GET", "/api/cart", undefined, token)).json().data.items,
    ).toHaveLength(1);
  });

  it("refuses buy-now too", async () => {
    const { token } = await newcomer();
    const res = await call(
      "POST",
      "/api/orders/buy-now",
      {
        productId: mango.id,
        quantity: 1,
        paymentMethod: "cod",
        shipping,
      },
      token,
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("EMAIL_NOT_VERIFIED");
    expect(await stock()).toBe(10);
  });
});

describe("email verification policy", () => {
  it("takes effect immediately with the existing access token", async () => {
    const { token } = await newcomer();
    await addToCart(token);
    expect((await checkout(token)).statusCode).toBe(403);

    await flushMail(app);
    const code = transport.codeFor(email);
    expect(
      (
        await call("POST", "/api/auth/verify-email", { email, code })
      ).statusCode,
    ).toBe(200);

    expect((await checkout(token)).statusCode).toBe(201);
    expect(await stock()).toBe(8);
  });

  it("requires re-verification after an admin changes a user's email", async () => {
    const user = await createUser(app, { email: "veteran@example.com" });
    await addToCart(user.token);
    expect(
      (
        await call(
          "PUT",
          `/api/users/${user.id}`,
          { email: "moved@example.com" },
          admin.token,
        )
      ).statusCode,
    ).toBe(200);

    const res = await checkout(user.token);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("allows customers created by an admin to order immediately", async () => {
    await call(
      "POST",
      "/api/users",
      {
        fullName: "Staff-made",
        email: "made@example.com",
        password: "Secret123!",
      },
      admin.token,
    );
    const login = await call("POST", "/api/auth/login", {
      email: "made@example.com",
      password: "Secret123!",
    });
    const token = login.json().data.tokens.accessToken as string;
    await addToCart(token);
    expect((await checkout(token)).statusCode).toBe(201);
  });
});

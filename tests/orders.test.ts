import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
let customer: User;
let categoryId: number;
let mango: { id: number };
let carrot: { id: number };

beforeAll(async () => {
  app = await buildApp(testConfig(), { mailTransport: transport });
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
  transport.reset();
  admin = await createUser(app, { role: "admin" });
  customer = await createUser(app);
  categoryId = (
    await call("POST", "/api/categories", { name: "Fruit" }, admin.token)
  ).json().data.id;
  mango = await mk("Mango", 90000, 10);
  carrot = await mk("Carrot", 10000, 5);
});

const shipping = {
  receiverName: "Nguyen Van A",
  phone: "0901234567",
  address: "1 Le Loi, District 1, HCMC",
};
const addToCart = (
  productId: number,
  quantity: number,
  token = customer.token,
) => call("POST", "/api/cart/items", { productId, quantity }, token);
const checkout = (over: Record<string, unknown> = {}, token = customer.token) =>
  call(
    "POST",
    "/api/orders/checkout",
    { paymentMethod: "cod", shipping, ...over },
    token,
  );
const buyNow = (productId: number, quantity: number, token = customer.token) =>
  call(
    "POST",
    "/api/orders/buy-now",
    { productId, quantity, paymentMethod: "cod", shipping },
    token,
  );
const cancel = (
  id: number,
  token = customer.token,
  body: Record<string, unknown> = {},
) => call("POST", `/api/orders/${id}/cancel`, body, token);
const setStatus = (id: number, status: string, token = admin.token) =>
  call("PATCH", `/api/orders/${id}/status`, { status }, token);

const stock = async (id: number) =>
  (await app.knex("products").where({ id }).first()).quantity as number;
const ledger = (productId: number) =>
  app
    .knex("inventory_histories")
    .where({ product_id: productId })
    .orderBy("id");
const orderCount = async () => (await app.knex("orders")).length;
const orderId = (res: { json: () => { data: { order: { id: number } } } }) =>
  res.json().data.order.id;

describe("checkout", () => {
  it("requires a login", async () => {
    expect(
      (
        await call("POST", "/api/orders/checkout", {
          paymentMethod: "cod",
          shipping,
        })
      ).statusCode,
    ).toBe(401);
    expect((await call("GET", "/api/orders")).statusCode).toBe(401);
  });

  it("turns the cart into an order with snapshot lines and correct money", async () => {
    await addToCart(mango.id, 2);
    await addToCart(carrot.id, 3);
    const res = await checkout({ note: "Giao giờ hành chính" });

    expect(res.statusCode).toBe(201);
    const order = res.json().data.order;
    expect(order).toMatchObject({
      orderStatus: "pending",
      paymentMethod: "cod",
      paymentStatus: "unpaid",
      subtotal: 210000,
      shippingFee: 0,
      totalPrice: 210000,
      note: "Giao giờ hành chính",
      paidAt: null,
      receiver: {
        name: "Nguyen Van A",
        phone: "0901234567",
        address: shipping.address,
      },
    });
    expect(order.orderCode).toMatch(/^AG\d{6}[0-9A-F]{8}$/);
    expect(order.items).toEqual([
      {
        productId: mango.id,
        productName: "Mango",
        unit: "kg",
        quantity: 2,
        price: 90000,
        subtotal: 180000,
      },
      {
        productId: carrot.id,
        productName: "Carrot",
        unit: "kg",
        quantity: 3,
        price: 10000,
        subtotal: 30000,
      },
    ]);
    expect(res.json().data.payment).toBeNull();
  });

  it("empties the cart, decrements stock, and writes the ledger", async () => {
    await addToCart(mango.id, 2);
    const res = await checkout();
    const id = orderId(res);

    expect(
      (await call("GET", "/api/cart", undefined, customer.token)).json().data
        .items,
    ).toEqual([]);
    expect(await stock(mango.id)).toBe(8);

    const rows = await ledger(mango.id);
    expect(rows).toHaveLength(2); // the initial import + this order
    expect(rows[1]).toMatchObject({
      delta: -2,
      quantity_after: 8,
      reason: "order_placed",
      order_id: id,
      created_by: customer.id,
    });
  });

  it("records the first status in the history", async () => {
    await addToCart(mango.id, 1);
    const id = orderId(await checkout());
    const rows = await app
      .knex("order_status_histories")
      .where({ order_id: id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      from_status: null,
      to_status: "pending",
      changed_by: customer.id,
    });
  });

  it("queues the confirmation mail with the order, and the worker delivers it", async () => {
    await addToCart(mango.id, 2);
    const order = (await checkout()).json().data.order;

    const queued = await app
      .knex("mail_outbox")
      .where({ type: "order_placed" });
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      to_email: customer.email,
      status: "pending",
    });

    await flushMail(app);
    const mail = transport.sent.find((m) =>
      m.subject.includes(order.orderCode),
    );
    expect(mail?.to).toBe(customer.email);
    expect(mail?.html).toContain("Mango");
    expect(mail?.text).toMatch(/180\D?000/);
  });

  it("falls back to the profile name, phone and address when shipping is omitted", async () => {
    await call(
      "PUT",
      "/api/me",
      {
        fullName: "Tran B",
        phone: "0912345678",
        address: "2 Nguyen Hue, HCMC",
      },
      customer.token,
    );
    await addToCart(carrot.id, 1);
    const res = await call(
      "POST",
      "/api/orders/checkout",
      { paymentMethod: "cod" },
      customer.token,
    );
    expect(res.json().data.order.receiver).toEqual({
      name: "Tran B",
      phone: "0912345678",
      address: "2 Nguyen Hue, HCMC",
    });
  });

  it("needs a phone and an address from somewhere, and creates nothing without them", async () => {
    await addToCart(carrot.id, 1);
    const res = await call(
      "POST",
      "/api/orders/checkout",
      { paymentMethod: "cod" },
      customer.token,
    );
    expect(res.statusCode).toBe(422);
    expect(
      res
        .json()
        .errors.map((e: { field: string }) => e.field)
        .sort(),
    ).toEqual(["shipping.address", "shipping.phone"]);
    expect(await orderCount()).toBe(0);
    expect(await stock(carrot.id)).toBe(5);
  });

  it("refuses an empty cart", async () => {
    const res = await checkout();
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toBe("Your cart is empty");
  });

  it("keeps the price it sold at, even if the price changes later", async () => {
    await addToCart(mango.id, 1);
    const id = orderId(await checkout());
    await call("PUT", `/api/products/${mango.id}`, { price: 1 }, admin.token);

    const order = (
      await call("GET", `/api/orders/${id}`, undefined, customer.token)
    ).json().data;
    expect(order.items[0]).toMatchObject({ price: 90000, subtotal: 90000 });
    expect(order.totalPrice).toBe(90000);
  });

  it("adds the configured shipping fee", async () => {
    const withFee = await buildApp(testConfig({ SHIPPING_FEE: "30000" }), {
      mailTransport: transport,
    });
    try {
      await addToCart(mango.id, 1);
      const res = await withFee.inject({
        method: "POST",
        url: "/api/orders/checkout",
        payload: { paymentMethod: "cod", shipping },
        headers: { authorization: `Bearer ${customer.token}` },
      });
      expect(res.json().data.order).toMatchObject({
        subtotal: 90000,
        shippingFee: 30000,
        totalPrice: 120000,
      });
    } finally {
      await withFee.close();
    }
  });

  it("refuses VNPay when it is not configured, before any stock is reserved", async () => {
    await addToCart(mango.id, 1);
    const res = await checkout({ paymentMethod: "vnpay" });
    expect(res.statusCode).toBe(503);
    expect(await orderCount()).toBe(0);
    expect(await stock(mango.id)).toBe(10);
    expect((await checkout({ paymentMethod: "bitcoin" })).statusCode).toBe(422);
  });
});

describe("checkout refusals are all-or-nothing", () => {
  it("reports the short item and changes nothing", async () => {
    await addToCart(mango.id, 5);
    await call(
      "PATCH",
      `/api/products/${mango.id}/quantity`,
      { quantity: 3 },
      admin.token,
    ); // stock drops below the cart

    const res = await checkout();
    expect(res.statusCode).toBe(422);
    expect(res.json().errors).toEqual([
      { productId: mango.id, message: "Only 3 kg left in stock" },
    ]);

    expect(await orderCount()).toBe(0);
    expect(await stock(mango.id)).toBe(3);
    expect((await ledger(mango.id)).map((r) => r.reason)).toEqual([
      "import",
      "adjustment",
    ]); // no order_placed row
    expect(
      await app.knex("mail_outbox").where({ type: "order_placed" }),
    ).toHaveLength(0);
    expect(
      (await call("GET", "/api/cart", undefined, customer.token)).json().data
        .items,
    ).toHaveLength(1); // cart kept
  });

  it("does not touch the good line when another line fails", async () => {
    await addToCart(mango.id, 2); // fine
    await addToCart(carrot.id, 5); // fine now...
    await call(
      "PATCH",
      `/api/products/${carrot.id}/quantity`,
      { quantity: 1 },
      admin.token,
    ); // ...no longer

    expect((await checkout()).statusCode).toBe(422);
    expect(await stock(mango.id)).toBe(10); // the valid line was NOT sold
    expect(await orderCount()).toBe(0);
  });

  it("refuses inactive and deleted products", async () => {
    await addToCart(mango.id, 1);
    await call(
      "PATCH",
      `/api/products/${mango.id}/status`,
      { status: "inactive" },
      admin.token,
    );
    const res = await checkout();
    expect(res.statusCode).toBe(422);
    expect(res.json().errors[0]).toEqual({
      productId: mango.id,
      message: "Product is no longer available",
    });

    await call(
      "PATCH",
      `/api/products/${mango.id}/status`,
      { status: "active" },
      admin.token,
    );
    await call("DELETE", `/api/products/${mango.id}`, undefined, admin.token);
    expect((await checkout()).statusCode).toBe(422);
  });
});

describe("buy now", () => {
  it("orders one product and leaves the cart alone", async () => {
    await addToCart(carrot.id, 2);
    const res = await buyNow(mango.id, 4);
    expect(res.statusCode).toBe(201);
    expect(res.json().data.order).toMatchObject({
      subtotal: 360000,
      totalPrice: 360000,
    });
    expect(await stock(mango.id)).toBe(6);
    expect(
      (await call("GET", "/api/cart", undefined, customer.token)).json().data
        .items,
    ).toHaveLength(1);
  });

  it("validates quantity and stock", async () => {
    expect((await buyNow(mango.id, 0)).statusCode).toBe(422);
    const res = await buyNow(mango.id, 11);
    expect(res.statusCode).toBe(422);
    expect(await orderCount()).toBe(0);
    expect(await stock(mango.id)).toBe(10);
  });

  it("refuses an unknown product", async () => {
    expect((await buyNow(99999, 1)).statusCode).toBe(422);
  });
});

describe("concurrency: stock can never be oversold", () => {
  it("sells the LAST unit to exactly one of two buyers", async () => {
    const last = await mk("Last one", 50000, 1);
    const other = await createUser(app, { email: "other@example.com" });
    await addToCart(last.id, 1, customer.token);
    await addToCart(last.id, 1, other.token);

    const results = await Promise.all([
      checkout({}, customer.token),
      checkout({}, other.token),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 422]);

    expect(await stock(last.id)).toBe(0);
    expect(
      await app.knex("order_details").where({ product_id: last.id }),
    ).toHaveLength(1);
    const rows = await ledger(last.id);
    expect(rows.reduce((sum, r) => sum + r.delta, 0)).toBe(0); // +1 import, -1 sale
    expect(rows.at(-1)?.quantity_after).toBe(0);
  });

  it("sells exactly the stock when many buyers race for it", async () => {
    const scarce = await mk("Scarce", 10000, 3);
    const buyers = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        createUser(app, { email: `buyer${i}@example.com` }),
      ),
    );
    await Promise.all(buyers.map((b) => addToCart(scarce.id, 1, b.token)));

    const results = await Promise.all(buyers.map((b) => checkout({}, b.token)));
    const codes = results.map((r) => r.statusCode);

    expect(codes.every((c) => c === 201 || c === 422)).toBe(true); // never a 500 (deadlock, constraint)
    expect(codes.filter((c) => c === 201)).toHaveLength(3);
    expect(await stock(scarce.id)).toBe(0);
    expect((await ledger(scarce.id)).reduce((sum, r) => sum + r.delta, 0)).toBe(
      0,
    );
  });

  it("lets one cart be checked out only once when two requests arrive together", async () => {
    await addToCart(mango.id, 2);
    const results = await Promise.all([checkout(), checkout()]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 422]);
    expect(await orderCount()).toBe(1);
    expect(await stock(mango.id)).toBe(8); // decremented once, not twice
  });

  it("never deadlocks when carts list the same products in opposite order", async () => {
    const a = await mk("Aaa", 1000, 1000);
    const b = await mk("Bbb", 1000, 1000);
    const other = await createUser(app, { email: "other@example.com" });

    for (let round = 0; round < 10; round++) {
      await addToCart(a.id, 1, customer.token);
      await addToCart(b.id, 1, customer.token);
      await addToCart(b.id, 1, other.token); // opposite order
      await addToCart(a.id, 1, other.token);
      const results = await Promise.all([
        checkout({}, customer.token),
        checkout({}, other.token),
      ]);
      expect(results.map((r) => r.statusCode)).toEqual([201, 201]);
    }
    expect(await stock(a.id)).toBe(1000 - 20);
    expect(await stock(b.id)).toBe(1000 - 20);
  });
});

describe("reading orders", () => {
  it("lists my orders newest first, with pagination", async () => {
    const ids: number[] = [];
    for (const qty of [1, 2, 3]) ids.push(orderId(await buyNow(mango.id, qty)));

    const res = await call(
      "GET",
      "/api/orders?perPage=2",
      undefined,
      customer.token,
    );
    expect(res.json().meta).toEqual({
      page: 1,
      perPage: 2,
      total: 3,
      totalPages: 2,
    });
    expect(res.json().data.map((o: { id: number }) => o.id)).toEqual([
      ids[2],
      ids[1],
    ]);
    expect(res.json().data[0].items).toHaveLength(1);

    const page2 = await call(
      "GET",
      "/api/orders?perPage=2&page=2",
      undefined,
      customer.token,
    );
    expect(page2.json().data.map((o: { id: number }) => o.id)).toEqual([
      ids[0],
    ]);
  });

  it("shows customers only their own orders, whatever they ask for", async () => {
    const other = await createUser(app, { email: "other@example.com" });
    await buyNow(mango.id, 1);
    await buyNow(mango.id, 1, other.token);

    const mine = await call("GET", "/api/orders", undefined, customer.token);
    expect(mine.json().meta.total).toBe(1);
    const snoop = await call(
      "GET",
      `/api/orders?userId=${other.id}`,
      undefined,
      customer.token,
    );
    expect(snoop.json().data.every((o: { id: number }) => o.id)).toBe(true);
    expect(snoop.json().meta.total).toBe(1); // still only their own

    const all = await call("GET", "/api/orders", undefined, admin.token);
    expect(all.json().meta.total).toBe(2);
    const filtered = await call(
      "GET",
      `/api/orders?userId=${other.id}`,
      undefined,
      admin.token,
    );
    expect(filtered.json().meta.total).toBe(1);
  });

  it("filters by order status", async () => {
    const first = orderId(await buyNow(mango.id, 1));
    await buyNow(mango.id, 1);
    await cancel(first);
    const res = await call(
      "GET",
      "/api/orders?orderStatus=cancelled",
      undefined,
      customer.token,
    );
    expect(res.json().data.map((o: { id: number }) => o.id)).toEqual([first]);
  });

  it("hides other people's orders behind a 404, but shows them to admins", async () => {
    const other = await createUser(app, { email: "other@example.com" });
    const id = orderId(await buyNow(mango.id, 1));
    expect(
      (await call("GET", `/api/orders/${id}`, undefined, other.token))
        .statusCode,
    ).toBe(404);
    expect(
      (await call("GET", `/api/orders/${id}`, undefined, customer.token))
        .statusCode,
    ).toBe(200);
    expect(
      (await call("GET", `/api/orders/${id}`, undefined, admin.token))
        .statusCode,
    ).toBe(200);
    expect(
      (await call("GET", "/api/orders/99999", undefined, customer.token))
        .statusCode,
    ).toBe(404);
    expect(
      (await call("GET", "/api/orders/abc", undefined, customer.token))
        .statusCode,
    ).toBe(422);
  });
});

describe("cancelling", () => {
  it("restocks, records the ledger, and marks the order cancelled", async () => {
    const id = orderId(await buyNow(mango.id, 3));
    expect(await stock(mango.id)).toBe(7);

    const res = await cancel(id, customer.token, { reason: "Changed my mind" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      orderStatus: "cancelled",
      cancelReason: "Changed my mind",
    });
    expect(res.json().data.cancelledAt).not.toBeNull();

    expect(await stock(mango.id)).toBe(10);
    const rows = await ledger(mango.id);
    expect(rows.at(-1)).toMatchObject({
      delta: 3,
      quantity_after: 10,
      reason: "order_cancelled",
      order_id: id,
    });

    const history = await app
      .knex("order_status_histories")
      .where({ order_id: id })
      .orderBy("id");
    expect(history.map((h) => h.to_status)).toEqual(["pending", "cancelled"]);
  });

  it("uses a default reason", async () => {
    const id = orderId(await buyNow(mango.id, 1));
    expect((await cancel(id)).json().data.cancelReason).toBe(
      "Cancelled by customer",
    );
  });

  it("cannot cancel twice", async () => {
    const id = orderId(await buyNow(mango.id, 1));
    await cancel(id);
    const again = await cancel(id);
    expect(again.statusCode).toBe(409);
    expect(await stock(mango.id)).toBe(10); // restocked once
  });

  it("keeps one customer from cancelling another customer's order", async () => {
    const other = await createUser(app, { email: "other@example.com" });
    const id = orderId(await buyNow(mango.id, 1));
    expect((await cancel(id, other.token)).statusCode).toBe(404);
    expect(await stock(mango.id)).toBe(9);
  });

  it("stops the customer once an admin has confirmed the order, but not the admin", async () => {
    const id = orderId(await buyNow(mango.id, 2));
    await setStatus(id, "confirmed");

    const mine = await cancel(id);
    expect(mine.statusCode).toBe(409);
    expect(mine.json().message).toMatch(/contact support/);

    expect((await cancel(id, admin.token)).statusCode).toBe(200);
    expect(await stock(mango.id)).toBe(10);
  });

  it("still restocks a product that was deleted after the order", async () => {
    const id = orderId(await buyNow(mango.id, 2));
    await call("DELETE", `/api/products/${mango.id}`, undefined, admin.token);
    expect((await cancel(id)).statusCode).toBe(200);
    expect(await stock(mango.id)).toBe(10); // read straight from the table
  });

  it("restocks exactly once when two cancels race", async () => {
    const id = orderId(await buyNow(mango.id, 4));
    const results = await Promise.all([
      cancel(id, customer.token),
      cancel(id, admin.token),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await stock(mango.id)).toBe(10); // not 14
  });
});

describe("admin status flow", () => {
  it("walks pending > confirmed > shipping > completed, and cash on delivery becomes paid", async () => {
    const id = orderId(await buyNow(mango.id, 1));
    for (const status of ["confirmed", "shipping"]) {
      expect((await setStatus(id, status)).json().data).toMatchObject({
        orderStatus: status,
        paymentStatus: "unpaid",
      });
    }
    const done = await setStatus(id, "completed");
    expect(done.json().data).toMatchObject({
      orderStatus: "completed",
      paymentStatus: "paid",
    });
    expect(done.json().data.paidAt).not.toBeNull();

    const rows = await app
      .knex("order_status_histories")
      .where({ order_id: id })
      .orderBy("id");
    expect(rows.map((r) => [r.from_status, r.to_status])).toEqual([
      [null, "pending"],
      ["pending", "confirmed"],
      ["confirmed", "shipping"],
      ["shipping", "completed"],
    ]);
    expect(rows[1].changed_by).toBe(admin.id);
  });

  it("refuses illegal jumps", async () => {
    const id = orderId(await buyNow(mango.id, 1));
    expect((await setStatus(id, "completed")).statusCode).toBe(409);
    expect((await setStatus(id, "shipping")).statusCode).toBe(409);
    expect((await setStatus(id, "pending")).statusCode).toBe(409);
  });

  it("treats completed and cancelled as final", async () => {
    const done = orderId(await buyNow(mango.id, 1));
    for (const s of ["confirmed", "shipping", "completed"])
      await setStatus(done, s);
    expect((await setStatus(done, "cancelled")).statusCode).toBe(409);
    expect((await cancel(done, admin.token)).statusCode).toBe(409);

    const dead = orderId(await buyNow(mango.id, 1));
    await cancel(dead);
    expect((await setStatus(dead, "confirmed")).statusCode).toBe(409);
  });

  it("cancelling through the status endpoint restocks too", async () => {
    const id = orderId(await buyNow(mango.id, 5));
    expect((await setStatus(id, "cancelled")).json().data.cancelReason).toBe(
      "Cancelled by admin",
    );
    expect(await stock(mango.id)).toBe(10);
  });

  it("is admin only", async () => {
    const id = orderId(await buyNow(mango.id, 1));
    expect((await setStatus(id, "confirmed", customer.token)).statusCode).toBe(
      403,
    );
    expect(
      (await call("PATCH", `/api/orders/${id}/status`, { status: "confirmed" }))
        .statusCode,
    ).toBe(401);
  });

  it("answers 404 for an unknown order and 422 for an unknown status", async () => {
    expect((await setStatus(99999, "confirmed")).statusCode).toBe(404);
    const id = orderId(await buyNow(mango.id, 1));
    expect((await setStatus(id, "teleported")).statusCode).toBe(422);
  });
});

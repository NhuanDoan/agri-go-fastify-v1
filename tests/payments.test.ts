import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  CaptureTransport,
  VNPAY_TEST,
  caller,
  createUser,
  flushMail,
  resetDb,
  signVnpay,
  testConfig,
  vnpayEnv,
  vnpayQuery,
} from "./helpers.js";

let app: FastifyInstance;
const transport = new CaptureTransport();
const call = caller(() => app);
type User = Awaited<ReturnType<typeof createUser>>;
let admin: User;
let customer: User;
let mango: { id: number }; // price 90000, stock 10

beforeAll(async () => {
  app = await buildApp(testConfig(vnpayEnv()), { mailTransport: transport });
});
afterAll(() => app.close());

beforeEach(async () => {
  await resetDb(app.knex);
  transport.reset();
  admin = await createUser(app, { role: "admin" });
  customer = await createUser(app);
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

/** Checks out 2 mango (180000 VND) with VNPay. */
async function placeVnpayOrder(token = customer.token, quantity = 2) {
  await call(
    "POST",
    "/api/cart/items",
    { productId: mango.id, quantity },
    token,
  );
  const res = await call(
    "POST",
    "/api/orders/checkout",
    { paymentMethod: "vnpay", shipping },
    token,
  );
  return res.json().data as {
    order: { id: number; orderCode: string; totalPrice: number };
    payment: { paymentUrl: string; txnRef: string; expiresAt: string };
  };
}

const ipn = (query: string) =>
  app.inject({ method: "GET", url: `/api/payments/vnpay/ipn?${query}` });
const pay = (
  txnRef: string,
  amount: number,
  over: { responseCode?: string } = {},
) => ipn(vnpayQuery({ txnRef, amount, ...over }));
const back = (query: string) =>
  app.inject({ method: "GET", url: `/api/payments/vnpay/return?${query}` });
const newLink = (orderId: number, token = customer.token) =>
  call("POST", `/api/orders/${orderId}/payment`, undefined, token);

const orderRow = (id: number) => app.knex("orders").where({ id }).first();
const paymentRow = (txnRef: string) =>
  app.knex("payments").where({ txn_ref: txnRef }).first();
const history = (orderId: number) =>
  app.knex("order_status_histories").where({ order_id: orderId }).orderBy("id");
const stock = async () =>
  (await app.knex("products").where({ id: mango.id }).first())
    .quantity as number;
const outboxCount = (type: string) =>
  app
    .knex("mail_outbox")
    .where({ type })
    .then((rows) => rows.length);
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
const redirectOf = (res: { headers: Record<string, unknown> }) =>
  new URL(String(res.headers.location));

describe("creating the payment link", () => {
  it("checks out with VNPay: order pending, payment pending, stock reserved", async () => {
    const { order, payment } = await placeVnpayOrder();
    expect(order.totalPrice).toBe(180000);
    expect(await orderRow(order.id)).toMatchObject({
      payment_method: "vnpay",
      payment_status: "unpaid",
      order_status: "pending",
    });
    expect(await stock()).toBe(8);

    expect(payment.txnRef).toBe(`${order.orderCode}R1`);
    expect(await paymentRow(payment.txnRef)).toMatchObject({
      order_id: order.id,
      provider: "vnpay",
      amount: 180000,
      status: "pending",
    });
    expect(new Date(payment.expiresAt).getTime()).toBeGreaterThan(
      Date.now() + 14 * 60_000,
    );
  });

  it("returns a correctly signed URL for exactly this amount and reference", async () => {
    const { payment } = await placeVnpayOrder();
    expect(
      payment.paymentUrl.startsWith(
        "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?",
      ),
    ).toBe(true);

    const { vnp_SecureHash, ...params } = Object.fromEntries(
      new URL(payment.paymentUrl).searchParams,
    ) as Record<string, string>;
    expect(params).toMatchObject({
      vnp_Amount: "18000000",
      vnp_TxnRef: payment.txnRef,
      vnp_TmnCode: VNPAY_TEST.tmnCode,
      vnp_CurrCode: "VND",
      vnp_Command: "pay",
    });
    expect(params.vnp_OrderInfo).toMatch(/^Thanh toan don hang AG/); // ASCII only
    expect(signVnpay(params)).toBe(vnp_SecureHash); // verified by the independent signer
  });

  it("works for buy-now too", async () => {
    const res = await call(
      "POST",
      "/api/orders/buy-now",
      { productId: mango.id, quantity: 1, paymentMethod: "vnpay", shipping },
      customer.token,
    );
    expect(res.statusCode).toBe(201);
    expect(res.json().data.payment.txnRef).toMatch(/R1$/);
  });

  it("gives a second attempt a new reference", async () => {
    const { order, payment } = await placeVnpayOrder();
    const res = await newLink(order.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.txnRef).toBe(`${order.orderCode}R2`);
    expect(res.json().data.txnRef).not.toBe(payment.txnRef);
    expect(
      await app.knex("payments").where({ order_id: order.id }),
    ).toHaveLength(2);
  });

  it("numbers concurrent attempts without clashes", async () => {
    const { order } = await placeVnpayOrder();
    const results = await Promise.all([
      newLink(order.id),
      newLink(order.id),
      newLink(order.id),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    const refs = results.map((r) => r.json().data.txnRef as string).sort();
    expect(refs).toEqual([
      `${order.orderCode}R2`,
      `${order.orderCode}R3`,
      `${order.orderCode}R4`,
    ]);
  });

  it("is only available to the order's owner", async () => {
    const { order } = await placeVnpayOrder();
    const other = await createUser(app, { email: "other@example.com" });
    expect((await newLink(order.id, other.token)).statusCode).toBe(404);
    expect(
      (await call("POST", `/api/orders/${order.id}/payment`)).statusCode,
    ).toBe(401);
  });

  it("is refused for cash-on-delivery, paid and cancelled orders", async () => {
    await call(
      "POST",
      "/api/cart/items",
      { productId: mango.id, quantity: 1 },
      customer.token,
    );
    const cod = (
      await call(
        "POST",
        "/api/orders/checkout",
        { paymentMethod: "cod", shipping },
        customer.token,
      )
    ).json().data.order;
    expect((await newLink(cod.id)).statusCode).toBe(409);

    const paid = await placeVnpayOrder();
    await pay(paid.payment.txnRef, 180000);
    expect((await newLink(paid.order.id)).statusCode).toBe(409);

    const cancelled = await placeVnpayOrder();
    await call(
      "POST",
      `/api/orders/${cancelled.order.id}/cancel`,
      {},
      customer.token,
    );
    expect((await newLink(cancelled.order.id)).statusCode).toBe(409);
  });

  it("is refused once the order's payment window has closed", async () => {
    const { order } = await placeVnpayOrder();
    await app
      .knex("orders")
      .where({ id: order.id })
      .update({ created_at: ago(30) }); // window = 15 + 5 minutes
    const res = await newLink(order.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/payment window/);
  });

  it("answers 503, with nothing reserved, when VNPay is not configured", async () => {
    const plain = await buildApp(testConfig(), { mailTransport: transport });
    try {
      await call(
        "POST",
        "/api/cart/items",
        { productId: mango.id, quantity: 1 },
        customer.token,
      );
      const res = await plain.inject({
        method: "POST",
        url: "/api/orders/checkout",
        payload: { paymentMethod: "vnpay", shipping },
        headers: { authorization: `Bearer ${customer.token}` },
      });
      expect(res.statusCode).toBe(503);
      expect(await stock()).toBe(10);
      expect(await app.knex("orders")).toHaveLength(0);
    } finally {
      await plain.close();
    }
  });
});

describe("IPN: the only thing that marks an order paid", () => {
  it("confirms the order, records the payment and queues the mail", async () => {
    const { order, payment } = await placeVnpayOrder();
    const res = await pay(payment.txnRef, 180000);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ RspCode: "00", Message: "Confirm Success" });

    const row = await paymentRow(payment.txnRef);
    expect(row).toMatchObject({
      status: "success",
      provider_txn_no: "14012345",
      bank_code: "NCB",
      response_code: "00",
    });
    expect(row.paid_at.toISOString()).toBe("2025-01-01T03:30:00.000Z"); // VNPay's GMT+7 time, converted
    expect(row.raw_payload).toMatchObject({
      vnp_TxnRef: payment.txnRef,
      vnp_Amount: "18000000",
    });

    const o = await orderRow(order.id);
    expect(o).toMatchObject({
      order_status: "confirmed",
      payment_status: "paid",
    });
    expect(o.paid_at.toISOString()).toBe("2025-01-01T03:30:00.000Z");

    const last = (await history(order.id)).at(-1)!;
    expect(last).toMatchObject({
      from_status: "pending",
      to_status: "confirmed",
      changed_by: null,
    });
    expect(last.note).toContain(payment.txnRef);

    expect(await stock()).toBe(8); // reserved at checkout, untouched by payment

    await flushMail(app);
    const mail = transport.sent.find((m) =>
      m.subject.includes("Thanh toán thành công"),
    );
    expect(mail?.to).toBe(customer.email);
    expect(mail?.subject).toContain(order.orderCode);
  });

  it("is idempotent: a repeated IPN answers 02 and changes nothing", async () => {
    const { order, payment } = await placeVnpayOrder();
    await pay(payment.txnRef, 180000);
    const before = {
      history: (await history(order.id)).length,
      mails: await outboxCount("payment_success"),
    };

    for (let i = 0; i < 3; i++)
      expect((await pay(payment.txnRef, 180000)).json()).toEqual({
        RspCode: "02",
        Message: "Order already confirmed",
      });

    expect((await history(order.id)).length).toBe(before.history);
    expect(await outboxCount("payment_success")).toBe(1);
    expect(await paymentRow(payment.txnRef)).toMatchObject({
      status: "success",
    });
  });

  it("survives two identical IPNs arriving at the same moment", async () => {
    const { order, payment } = await placeVnpayOrder();
    const results = await Promise.all([
      pay(payment.txnRef, 180000),
      pay(payment.txnRef, 180000),
    ]);
    expect(results.map((r) => r.json().RspCode).sort()).toEqual(["00", "02"]);
    expect(
      (await history(order.id)).filter((h) => h.to_status === "confirmed"),
    ).toHaveLength(1);
    expect(await outboxCount("payment_success")).toBe(1);
  });

  it("rejects a bad signature (97) and changes nothing", async () => {
    const { order, payment } = await placeVnpayOrder();
    const forged = await ipn(
      vnpayQuery({ txnRef: payment.txnRef, amount: 180000 }, "another-secret"),
    );
    expect(forged.json()).toEqual({
      RspCode: "97",
      Message: "Invalid signature",
    });

    expect(await paymentRow(payment.txnRef)).toMatchObject({
      status: "pending",
    });
    expect(await orderRow(order.id)).toMatchObject({
      payment_status: "unpaid",
      order_status: "pending",
    });
  });

  it("rejects a signed message that was edited afterwards (97)", async () => {
    const { payment } = await placeVnpayOrder();
    const q = new URLSearchParams(
      vnpayQuery({
        txnRef: payment.txnRef,
        amount: 180000,
        responseCode: "24",
      }),
    );
    q.set("vnp_ResponseCode", "00"); // the attacker flips "failed" into "success"
    q.set("vnp_TransactionStatus", "00");
    expect((await ipn(q.toString())).json().RspCode).toBe("97");
    expect(await paymentRow(payment.txnRef)).toMatchObject({
      status: "pending",
    });
  });

  it("rejects an IPN without any parameters (97)", async () => {
    expect((await ipn("")).json().RspCode).toBe("97");
  });

  it("rejects a repeated parameter (97)", async () => {
    const { payment } = await placeVnpayOrder();
    const q = `${vnpayQuery({ txnRef: payment.txnRef, amount: 180000 })}&vnp_ResponseCode=99`;
    expect((await ipn(q)).json().RspCode).toBe("97");
  });

  it("refuses a correctly signed IPN for the wrong amount (04)", async () => {
    const { order, payment } = await placeVnpayOrder();
    expect((await pay(payment.txnRef, 100)).json()).toEqual({
      RspCode: "04",
      Message: "Invalid amount",
    });
    expect(await paymentRow(payment.txnRef)).toMatchObject({
      status: "pending",
    });
    expect(await orderRow(order.id)).toMatchObject({
      payment_status: "unpaid",
    });
  });

  it("answers 01 for an unknown reference", async () => {
    expect((await pay("AG000000000000000R1", 1000)).json()).toEqual({
      RspCode: "01",
      Message: "Order not found",
    });
  });

  it("records a failed payment, keeps the order payable, and lets the customer retry", async () => {
    const { order, payment } = await placeVnpayOrder();
    expect(
      (await pay(payment.txnRef, 180000, { responseCode: "24" })).json()
        .RspCode,
    ).toBe("00"); // we handled it
    expect(await paymentRow(payment.txnRef)).toMatchObject({
      status: "failed",
      response_code: "24",
      paid_at: null,
    });
    expect(await orderRow(order.id)).toMatchObject({
      order_status: "pending",
      payment_status: "unpaid",
    });
    expect(await stock()).toBe(8); // the stock stays reserved while the customer can still retry
    expect(await outboxCount("payment_success")).toBe(0);

    expect((await pay(payment.txnRef, 180000)).json().RspCode).toBe("02"); // a failed attempt is final

    const retry = await newLink(order.id);
    expect(retry.statusCode).toBe(200);
    expect((await pay(retry.json().data.txnRef, 180000)).json().RspCode).toBe(
      "00",
    );
    expect(await orderRow(order.id)).toMatchObject({
      order_status: "confirmed",
      payment_status: "paid",
    });
  });

  it("flags money that arrives AFTER the order was cancelled for a refund", async () => {
    const { order, payment } = await placeVnpayOrder();
    expect(
      (await call("POST", `/api/orders/${order.id}/cancel`, {}, customer.token))
        .statusCode,
    ).toBe(200);
    expect(await stock()).toBe(10); // restocked at cancel

    expect((await pay(payment.txnRef, 180000)).json().RspCode).toBe("00");
    expect(await paymentRow(payment.txnRef)).toMatchObject({
      status: "success",
      refund_status: "pending",
      refund_reason: "Paid after the order was cancelled",
    }); // the money is on record
    expect(await orderRow(order.id)).toMatchObject({
      order_status: "cancelled",
      payment_status: "refund_pending",
    });
    expect((await history(order.id)).at(-1)!.note).toMatch(/refund required/);
    expect(await stock()).toBe(10); // never sold twice
    expect(await outboxCount("payment_success")).toBe(0); // no "thanks for paying" for a cancelled order

    // the admin pays the money back in the VNPay portal, then records it
    expect(
      (
        await call(
          "POST",
          `/api/orders/${order.id}/refunded`,
          undefined,
          customer.token,
        )
      ).statusCode,
    ).toBe(403);
    const done = await call(
      "POST",
      `/api/orders/${order.id}/refunded`,
      undefined,
      admin.token,
    );
    expect(done.json().data.paymentStatus).toBe("refunded");
    expect(await paymentRow(payment.txnRef)).toMatchObject({
      refund_status: "refunded",
    });
    expect(
      (
        await call(
          "POST",
          `/api/orders/${order.id}/refunded`,
          undefined,
          admin.token,
        )
      ).statusCode,
    ).toBe(409);
  });

  it("records a duplicate payment and flags exactly that payment for refund, leaving the order untouched", async () => {
    const { order, payment: first } = await placeVnpayOrder();
    const second = (await newLink(order.id)).json().data as {
      txnRef: string;
    }; // two live links
    await pay(first.txnRef, 180000);
    const before = await orderRow(order.id);

    expect((await pay(second.txnRef, 180000)).json().RspCode).toBe("00");
    expect(await paymentRow(second.txnRef)).toMatchObject({
      status: "success",
      refund_status: "pending",
      refund_reason: "Duplicate payment: the order was already paid",
    });
    expect(await paymentRow(first.txnRef)).toMatchObject({
      status: "success",
      refund_status: "none",
    });

    const after = await orderRow(order.id);
    expect(after).toMatchObject({
      order_status: before.order_status,
      payment_status: "paid",
    });
    expect(after.paid_at).toEqual(before.paid_at);
    expect((await history(order.id)).at(-1)!.note).toMatch(/Duplicate payment/);
    expect(await outboxCount("payment_success")).toBe(1);

    const queue = await call("GET", "/api/payments/refunds", undefined, admin.token);
    expect(queue.json().data.map((r: { txnRef: string }) => r.txnRef)).toEqual([
      second.txnRef,
    ]);
  });

  it("keeps fulfilling an order that has a duplicate payment", async () => {
    const { order } = await paidTwice();
    for (const status of ["shipping", "completed"]) {
      expect(
        (
          await call(
            "PATCH",
            `/api/orders/${order.id}/status`,
            { status },
            admin.token,
          )
        ).statusCode,
      ).toBe(200);
    }
    expect(await orderRow(order.id)).toMatchObject({
      order_status: "completed",
      payment_status: "paid",
    });
  });

  it("does not downgrade an order that has already moved on", async () => {
    const { order, payment } = await placeVnpayOrder();
    await pay(payment.txnRef, 180000);
    await call(
      "PATCH",
      `/api/orders/${order.id}/status`,
      { status: "shipping" },
      admin.token,
    );
    expect(await orderRow(order.id)).toMatchObject({
      order_status: "shipping",
      payment_status: "paid",
    });
  });
});

describe("browser return: shows the result, never decides it", () => {
  it("shows success once the IPN has been processed", async () => {
    const { order, payment } = await placeVnpayOrder();
    await pay(payment.txnRef, 180000);
    const res = await back(
      vnpayQuery({ txnRef: payment.txnRef, amount: 180000 }),
    );
    expect(res.statusCode).toBe(302);
    const to = redirectOf(res);
    expect(`${to.origin}${to.pathname}`).toBe(
      "http://localhost:5173/payment/result",
    );
    expect(to.searchParams.get("status")).toBe("success");
    expect(to.searchParams.get("orderCode")).toBe(order.orderCode);
  });

  it('shows "processing" when the customer returns before the IPN arrives, and changes nothing', async () => {
    const { order, payment } = await placeVnpayOrder();
    const res = await back(
      vnpayQuery({ txnRef: payment.txnRef, amount: 180000 }),
    );
    expect(redirectOf(res).searchParams.get("status")).toBe("processing");
    expect(await paymentRow(payment.txnRef)).toMatchObject({
      status: "pending",
    }); // the return did NOT mark it paid
    expect(await orderRow(order.id)).toMatchObject({
      payment_status: "unpaid",
    });
  });

  it('shows "failed" for a declined payment', async () => {
    const { payment } = await placeVnpayOrder();
    const res = await back(
      vnpayQuery({
        txnRef: payment.txnRef,
        amount: 180000,
        responseCode: "24",
      }),
    );
    expect(redirectOf(res).searchParams.get("status")).toBe("failed");
  });

  it('shows "invalid" for a forged or tampered return, without revealing the order', async () => {
    const { payment } = await placeVnpayOrder();
    const forged = await back(
      vnpayQuery({ txnRef: payment.txnRef, amount: 180000 }, "another-secret"),
    );
    expect(redirectOf(forged).searchParams.get("status")).toBe("invalid");
    expect(redirectOf(forged).searchParams.get("orderCode")).toBeNull();

    const none = await back("");
    expect(redirectOf(none).searchParams.get("status")).toBe("invalid");

    const unknown = await back(
      vnpayQuery({ txnRef: "AG000000000000000R1", amount: 1000 }),
    );
    expect(redirectOf(unknown).searchParams.get("status")).toBe("invalid");
  });
});

describe("order rules for online payment", () => {
  it("does not let an admin progress an unpaid VNPay order, but does let them cancel it", async () => {
    const { order, payment } = await placeVnpayOrder();
    const blocked = await call(
      "PATCH",
      `/api/orders/${order.id}/status`,
      { status: "confirmed" },
      admin.token,
    );
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().message).toMatch(/must be paid/);

    await pay(payment.txnRef, 180000);
    for (const status of ["shipping", "completed"]) {
      expect(
        (
          await call(
            "PATCH",
            `/api/orders/${order.id}/status`,
            { status },
            admin.token,
          )
        ).statusCode,
      ).toBe(200);
    }
    expect(await orderRow(order.id)).toMatchObject({
      order_status: "completed",
      payment_status: "paid",
    });
  });

  it("lets the customer cancel an unpaid VNPay order, but not a paid one", async () => {
    const unpaid = await placeVnpayOrder();
    expect(
      (
        await call(
          "POST",
          `/api/orders/${unpaid.order.id}/cancel`,
          {},
          customer.token,
        )
      ).statusCode,
    ).toBe(200);

    const paid = await placeVnpayOrder();
    await pay(paid.payment.txnRef, 180000);
    const res = await call(
      "POST",
      `/api/orders/${paid.order.id}/cancel`,
      {},
      customer.token,
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/contact support/);
  });

  it("turns an admin cancellation of a PAID order into a pending refund, and restocks", async () => {
    const { order, payment } = await placeVnpayOrder();
    await pay(payment.txnRef, 180000);
    const res = await call(
      "POST",
      `/api/orders/${order.id}/cancel`,
      {},
      admin.token,
    );
    expect(res.json().data).toMatchObject({
      orderStatus: "cancelled",
      paymentStatus: "refund_pending",
    });
    expect(await paymentRow(payment.txnRef)).toMatchObject({
      refund_status: "pending",
      refund_reason: "Order cancelled after payment",
    });
    expect(await stock()).toBe(10);
  });
});

describe("expiring unpaid orders", () => {
  const sweep = () => app.services.orders.cancelExpiredUnpaid();
  const agedOrder = async (minutes: number) => {
    const placed = await placeVnpayOrder();
    await app
      .knex("orders")
      .where({ id: placed.order.id })
      .update({ created_at: ago(minutes) });
    return placed;
  };
  const killLink = (txnRef: string) =>
    app
      .knex("payments")
      .where({ txn_ref: txnRef })
      .update({ expires_at: ago(1) });

  it("cancels an old unpaid order once its payment link is dead, restocking and logging the system as actor", async () => {
    const { order, payment } = await agedOrder(30);
    await killLink(payment.txnRef);

    expect(await sweep()).toBe(1);
    expect(await orderRow(order.id)).toMatchObject({
      order_status: "cancelled",
      cancel_reason: "Payment timeout",
      payment_status: "unpaid",
    });
    expect(await stock()).toBe(10);

    const ledger = await app
      .knex("inventory_histories")
      .where({ product_id: mango.id })
      .orderBy("id");
    expect(ledger.at(-1)).toMatchObject({
      delta: 2,
      reason: "order_cancelled",
      order_id: order.id,
      created_by: null,
    });
    expect((await history(order.id)).at(-1)).toMatchObject({
      to_status: "cancelled",
      changed_by: null,
    });

    expect(await sweep()).toBe(0); // idempotent
  });

  it("never cancels an order whose payment link is still alive", async () => {
    const { order } = await agedOrder(30); // the link was created at checkout and lives 15 minutes
    expect(await sweep()).toBe(0);
    expect(await orderRow(order.id)).toMatchObject({ order_status: "pending" });
    expect(await stock()).toBe(8);
  });

  it("leaves recent, paid, and cash-on-delivery orders alone", async () => {
    const recent = await placeVnpayOrder();
    await killLink(recent.payment.txnRef);

    const paid = await agedOrder(30);
    await pay(paid.payment.txnRef, 180000);

    await call(
      "POST",
      "/api/cart/items",
      { productId: mango.id, quantity: 1 },
      customer.token,
    );
    const cod = (
      await call(
        "POST",
        "/api/orders/checkout",
        { paymentMethod: "cod", shipping },
        customer.token,
      )
    ).json().data.order;
    await app
      .knex("orders")
      .where({ id: cod.id })
      .update({ created_at: ago(300) });

    expect(await sweep()).toBe(0);
    expect(await orderRow(recent.order.id)).toMatchObject({
      order_status: "pending",
    });
    expect(await orderRow(paid.order.id)).toMatchObject({
      order_status: "confirmed",
    });
    expect(await orderRow(cod.id)).toMatchObject({ order_status: "pending" });
  });

  it("still records money that arrives after the timeout, as a pending refund", async () => {
    const { order, payment } = await agedOrder(30);
    await killLink(payment.txnRef);
    await sweep();

    expect((await pay(payment.txnRef, 180000)).json().RspCode).toBe("00");
    expect(await orderRow(order.id)).toMatchObject({
      order_status: "cancelled",
      payment_status: "refund_pending",
    });
    expect(await stock()).toBe(10);
  });
});

/** An order paid through two separate links; the second payment is the duplicate. */
async function paidTwice(token = customer.token) {
  const { order, payment: first } = await placeVnpayOrder(token);
  const second = (await newLink(order.id, token)).json().data as {
    txnRef: string;
  };
  await pay(first.txnRef, 180000);
  await pay(second.txnRef, 180000);
  return { order, first, second };
}

describe("refund queue", () => {
  const queue = (query = "", token = admin.token) =>
    call("GET", `/api/payments/refunds${query}`, undefined, token);
  const refund = (paymentId: number, token = admin.token) =>
    call("POST", `/api/payments/${paymentId}/refunded`, undefined, token);
  const idOf = async (txnRef: string) =>
    (await paymentRow(txnRef)).id as number;
  const txnRefs = (res: {
    json: () => { data: { txnRef: string }[] };
  }) => res.json().data.map((r) => r.txnRef);

  /** First payment succeeds, admin cancels, then the second live link is paid. */
  async function cancelledWithTwoPayments() {
    const { order, payment: first } = await placeVnpayOrder();
    const second = (await newLink(order.id)).json().data as {
      txnRef: string;
    };
    await pay(first.txnRef, 180000);
    await call("POST", `/api/orders/${order.id}/cancel`, {}, admin.token);
    await pay(second.txnRef, 180000);
    return { order, first, second };
  }

  it("is admin only", async () => {
    const { second } = await paidTwice();
    const id = await idOf(second.txnRef);
    expect((await call("GET", "/api/payments/refunds")).statusCode).toBe(401);
    expect((await queue("", customer.token)).statusCode).toBe(403);
    expect((await call("POST", `/api/payments/${id}/refunded`)).statusCode).toBe(401);
    expect((await refund(id, customer.token)).statusCode).toBe(403);
  });

  it("lists refunds oldest first with order and VNPay context", async () => {
    const a = await paidTwice();
    const b = await paidTwice();
    const res = await queue();
    expect(txnRefs(res)).toEqual([a.second.txnRef, b.second.txnRef]);
    expect(res.json().meta.total).toBe(2);
    expect(res.json().data[0]).toEqual({
      paymentId: await idOf(a.second.txnRef),
      txnRef: a.second.txnRef,
      providerTxnNo: "14012345",
      bankCode: "NCB",
      amount: 180000,
      paidAt: "2025-01-01T03:30:00.000Z",
      refundStatus: "pending",
      refundReason: "Duplicate payment: the order was already paid",
      refundedAt: null,
      refundedBy: null,
      order: {
        id: a.order.id,
        orderCode: a.order.orderCode,
        orderStatus: "confirmed",
        paymentStatus: "paid",
      },
    });
  });

  it("is empty when no payment requires a refund", async () => {
    const { payment } = await placeVnpayOrder();
    await pay(payment.txnRef, 180000);
    expect((await queue()).json().meta.total).toBe(0);
  });

  it("paginates and filters by refund status", async () => {
    const a = await paidTwice();
    const b = await paidTwice();
    const page = await queue("?perPage=1");
    expect(page.json().meta).toEqual({
      page: 1,
      perPage: 1,
      total: 2,
      totalPages: 2,
    });
    expect(txnRefs(page)).toEqual([a.second.txnRef]);
    expect((await queue("?status=refunded")).json().meta.total).toBe(0);

    await refund(await idOf(a.second.txnRef));
    expect((await queue()).json().meta.total).toBe(1);
    expect(txnRefs(await queue("?status=refunded"))).toEqual([a.second.txnRef]);
    expect((await queue("?status=all")).json().meta.total).toBe(2);
    expect((await queue("?status=whatever")).statusCode).toBe(422);
    expect(b.second.txnRef).not.toBe(a.second.txnRef);
  });

  it("records a refund without changing a paid order", async () => {
    const { order, second } = await paidTwice();
    const id = await idOf(second.txnRef);
    const res = await refund(id);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      paymentId: id,
      refundStatus: "refunded",
      refundedBy: admin.id,
    });
    expect(res.json().data.refundedAt).not.toBeNull();
    expect(await paymentRow(second.txnRef)).toMatchObject({
      refund_status: "refunded",
      refunded_by: admin.id,
    });
    expect((await history(order.id)).at(-1)).toMatchObject({
      note: `Refund of ${second.txnRef} completed`,
      changed_by: admin.id,
    });
    expect(await orderRow(order.id)).toMatchObject({
      payment_status: "paid",
      order_status: "confirmed",
    });
  });

  it("refuses duplicate, unknown, malformed, and unnecessary refunds", async () => {
    const { first, second } = await paidTwice();
    const id = await idOf(second.txnRef);
    await refund(id);
    const again = await refund(id);
    expect(again.statusCode).toBe(409);
    expect(again.json().message).toMatch(/already refunded/);
    expect((await refund(99999)).statusCode).toBe(404);
    expect((await refund(await idOf(first.txnRef))).statusCode).toBe(409);
    expect(
      (await call("POST", "/api/payments/abc/refunded", undefined, admin.token))
        .statusCode,
    ).toBe(422);
  });

  it("refuses payments that are pending or failed", async () => {
    const { payment } = await placeVnpayOrder();
    expect((await refund(await idOf(payment.txnRef))).statusCode).toBe(409);
    await pay(payment.txnRef, 180000, { responseCode: "24" });
    expect((await refund(await idOf(payment.txnRef))).statusCode).toBe(409);
  });

  it("closes a cancelled order only after every pending payment refund is recorded", async () => {
    const { order, first, second } = await cancelledWithTwoPayments();
    expect(await orderRow(order.id)).toMatchObject({
      order_status: "cancelled",
      payment_status: "refund_pending",
    });
    expect(txnRefs(await queue())).toEqual([first.txnRef, second.txnRef]);
    await refund(await idOf(first.txnRef));
    expect((await orderRow(order.id)).payment_status).toBe("refund_pending");
    await refund(await idOf(second.txnRef));
    expect((await orderRow(order.id)).payment_status).toBe("refunded");
    expect((await queue()).json().meta.total).toBe(0);
  });

  it("lets the order-level action record all pending refunds", async () => {
    const { order, first, second } = await cancelledWithTwoPayments();
    const res = await call(
      "POST",
      `/api/orders/${order.id}/refunded`,
      undefined,
      admin.token,
    );
    expect(res.json().data.paymentStatus).toBe("refunded");
    expect(await paymentRow(first.txnRef)).toMatchObject({
      refund_status: "refunded",
      refunded_by: admin.id,
    });
    expect(await paymentRow(second.txnRef)).toMatchObject({
      refund_status: "refunded",
    });
    expect((await queue()).json().meta.total).toBe(0);
  });

  it("handles concurrent refund requests without double recording or deadlock", async () => {
    const { second } = await paidTwice();
    const id = await idOf(second.txnRef);
    const results = await Promise.all([refund(id), refund(id), refund(id)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);

    const { order, payment } = await placeVnpayOrder();
    await pay(payment.txnRef, 180000);
    await call("POST", `/api/orders/${order.id}/cancel`, {}, admin.token);
    const raced = await Promise.all([
      refund(await idOf(payment.txnRef)),
      call("POST", `/api/orders/${order.id}/refunded`, undefined, admin.token),
    ]);
    expect(raced.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await orderRow(order.id)).payment_status).toBe("refunded");
  });
});

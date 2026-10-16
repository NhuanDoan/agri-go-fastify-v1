import type { FastifyInstance } from "fastify";
import type { Knex } from "knex";
import { createHmac } from "node:crypto";
import { loadConfig } from "../src/config/env.js";
import { MailMessage, MailTransport } from "../src/modules/mail/mail.types.js";

export const TEST_SECRETS = {
  access: "test-access-secret-0123456789abcdef0123456789",
  refresh: "test-refresh-secret-0123456789abcdef012345678",
};

/** Env for tests: the separate agrigo_test database, cheap bcrypt, no accidental rate limiting. */
export const testEnv = (): Record<string, string> => ({
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  DB_HOST: process.env.DB_HOST ?? "127.0.0.1",
  DB_PORT: process.env.DB_PORT ?? "5432",
  DB_USER: process.env.DB_USER ?? "postgres",
  DB_PASSWORD: process.env.DB_PASSWORD ?? "secret",
  DB_NAME: process.env.TEST_DB_NAME ?? "agrigo_test",
  JWT_ACCESS_SECRET: TEST_SECRETS.access,
  JWT_REFRESH_SECRET: TEST_SECRETS.refresh,
  BCRYPT_ROUNDS: "4", // 4 = fast; 12 in production
  RATE_LIMIT_MAX: "100000",
  AUTH_RATE_LIMIT_MAX: "100000",
  OTP_SECRET: "test-otp-secret-0123456789abcdef0123456789abcdef",
  OTP_RESEND_COOLDOWN_SECONDS: "0", // tests resend freely; the cool-down test overrides this
});

export const testConfig = (overrides: Record<string, string> = {}) =>
  loadConfig({ ...testEnv(), ...overrides });

/** Empty everything between tests (CASCADE also clears products, ledger, tokens...). */
export async function resetDb(db: Knex): Promise<void> {
  await db.raw(
    "TRUNCATE users, categories, mail_outbox RESTART IDENTITY CASCADE",
  );
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** `const call = caller(() => app)`; the getter exists because `app` is created in beforeAll. */
export const caller =
  (getApp: () => FastifyInstance) =>
  (
    method: Method,
    url: string,
    payload?: Record<string, unknown>,
    token?: string,
  ) =>
    getApp().inject({
      method,
      url,
      payload,
      headers: token ? bearer(token) : {},
    });

/** Registers a user, optionally promotes them, and returns a token that reflects the final role. */
export async function createUser(
  app: FastifyInstance,
  opts: {
    role?: "admin" | "customer";
    email?: string;
    verified?: boolean;
  } = {},
) {
  const role = opts.role ?? "customer";
  const email = opts.email ?? `${role}@example.com`;
  const password = "Secret123!";
  const reg = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { fullName: "Test User", email, password },
  });
  const id = reg.json().data.user.id as number;
  const patch: Record<string, unknown> = {};
  if (role === "admin") patch.role = role;
  if (opts.verified !== false) patch.email_verified_at = new Date();
  if (Object.keys(patch).length > 0)
    await app.knex("users").where({ id }).update(patch);
  // the role lives INSIDE the access token, so log in again after changing it
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  return {
    id,
    email,
    password,
    token: login.json().data.tokens.accessToken as string,
  };
}

/** Stands in for SMTP: records mail, and can be told to fail. */
export class CaptureTransport implements MailTransport {
  sent: MailMessage[] = [];
  failWith: Error | null = null;
  failFor = new Set<string>();

  async send(m: MailMessage): Promise<void> {
    if (this.failWith) throw this.failWith;
    if (this.failFor.has(m.to)) throw new Error(`cannot send to ${m.to}`);
    this.sent.push(m);
  }

  reset(): void {
    this.sent = [];
    this.failWith = null;
    this.failFor.clear();
  }

  /** The 6-digit code in the most recent mail to `to`. */
  codeFor(to: string): string {
    const mail = [...this.sent].reverse().find((m) => m.to === to);
    const code = mail?.text.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error(`no code mail was sent to ${to}`);
    return code;
  }
}

/** Run the outbox worker until the queue is empty (what the background job does every 5 s). */
export async function flushMail(app: FastifyInstance): Promise<void> {
  while ((await app.mail.processBatch(50)) > 0) {
    /* keep going */
  }
}

/**
 * Make a row look `ageMs` old. A plain UPDATE can't do it: the set_updated_at trigger
 * resets updated_at to now(). Table and trigger names are test constants, never user input.
 */
export async function backdateUpdatedAt(
  db: Knex,
  table: string,
  where: Record<string, unknown>,
  ageMs: number,
) {
  const trigger = `${table}_set_updated_at`;
  await db.transaction(async (trx) => {
    await trx.raw("ALTER TABLE ?? DISABLE TRIGGER ??", [table, trigger]);
    await trx(table)
      .where(where)
      .update({ updated_at: new Date(Date.now() - ageMs) });
    await trx.raw("ALTER TABLE ?? ENABLE TRIGGER ??", [table, trigger]);
  });
}

export const VNPAY_TEST = {
  tmnCode: "TESTTMN",
  hashSecret: "test-vnpay-hash-secret-0123456789",
};
export const vnpayEnv = (): Record<string, string> => ({
  VNPAY_TMN_CODE: VNPAY_TEST.tmnCode,
  VNPAY_HASH_SECRET: VNPAY_TEST.hashSecret,
});

/**
 * Independent re-implementation of VNPay's documented signing (sorted keys, URL-encoded, space as "+",
 * HMAC-SHA512). The tests sign with THIS, not with the production class, so a bug in one shows up as a mismatch.
 */
export function signVnpay(
  params: Record<string, string>,
  secret: string = VNPAY_TEST.hashSecret,
): string {
  const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, "+");
  const data = Object.keys(params)
    .sort()
    .map((k) => `${enc(k)}=${enc(params[k]!)}`)
    .join("&");
  return createHmac("sha512", secret)
    .update(Buffer.from(data, "utf-8"))
    .digest("hex");
}

/** The query string of a signed VNPay callback (IPN or browser return). */
export function vnpayQuery(
  p: {
    txnRef: string;
    amount: number;
    responseCode?: string;
    extra?: Record<string, string>;
  },
  secret?: string,
): string {
  const responseCode = p.responseCode ?? "00";
  const params: Record<string, string> = {
    vnp_Amount: String(p.amount * 100),
    vnp_BankCode: "NCB",
    vnp_BankTranNo: "VNP14012345",
    vnp_CardType: "ATM",
    vnp_OrderInfo: `Thanh toan don hang ${p.txnRef}`,
    vnp_PayDate: "20250101103000", // = 2025-01-01T03:30:00Z
    vnp_ResponseCode: responseCode,
    vnp_TmnCode: VNPAY_TEST.tmnCode,
    vnp_TransactionNo: "14012345",
    vnp_TransactionStatus: responseCode === "00" ? "00" : "02",
    vnp_TxnRef: p.txnRef,
    ...p.extra,
  };
  return new URLSearchParams({
    ...params,
    vnp_SecureHash: signVnpay(params, secret),
  }).toString();
}

/**
 * Makes `customer` a verified buyer of the product: a cash-on-delivery order that the admin moves to "completed".
 * (Uses one unit of stock. Returns the order id.)
 */
export async function completePurchase(
  app: FastifyInstance,
  admin: { token: string },
  customer: { token: string },
  productId: number,
): Promise<number> {
  const order = await app.inject({
    method: "POST",
    url: "/api/orders/buy-now",
    headers: bearer(customer.token),
    payload: {
      productId,
      quantity: 1,
      paymentMethod: "cod",
      shipping: {
        receiverName: "Test",
        phone: "0901234567",
        address: "1 Le Loi, District 1, HCMC",
      },
    },
  });
  const id = order.json().data.order.id as number;
  for (const status of ["confirmed", "shipping", "completed"]) {
    await app.inject({
      method: "PATCH",
      url: `/api/orders/${id}/status`,
      headers: bearer(admin.token),
      payload: { status },
    });
  }
  return id;
}

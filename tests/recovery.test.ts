import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  CaptureTransport,
  caller,
  flushMail,
  resetDb,
  testConfig,
} from "./helpers.js";

let app: FastifyInstance;
const transport = new CaptureTransport();
const call = caller(() => app);

beforeAll(async () => {
  app = await buildApp(testConfig(), { mailTransport: transport });
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb(app.knex);
  transport.reset();
});

const email = "a@example.com";
const password = "Secret123!";

const register = () =>
  call("POST", "/api/auth/register", { fullName: "A", email, password });
const verify = (code: string, to = email) =>
  call("POST", "/api/auth/verify-email", { email: to, code });
const forgot = (to = email) =>
  call("POST", "/api/auth/forgot-password", { email: to });
const reset = (code: string, newPassword = "Brand-new-1") =>
  call("POST", "/api/auth/reset-password", { email, code, newPassword });
const otps = (purpose: string) =>
  app.knex("user_otps").where({ purpose }).orderBy("id");

/** register, deliver the mail, return the code */
async function registered() {
  const res = await register();
  await flushMail(app);
  return { tokens: res.json().data.tokens, code: transport.codeFor(email) };
}

describe("email verification", () => {
  it("queues a verification mail together with registration", async () => {
    await register();
    const outbox = await app.knex("mail_outbox");
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      type: "email_verification",
      to_email: email,
      status: "pending",
    });
  });

  it("stores only a keyed hash of the code, never the code", async () => {
    const { code } = await registered();
    const [otp] = await otps("email_verification");
    expect(otp.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(otp.code_hash).not.toContain(code);
  });

  it("starts unverified, and the right code verifies", async () => {
    const { tokens, code } = await registered();
    const me = () => call("GET", "/api/me", undefined, tokens.accessToken);
    expect((await me()).json().data.emailVerifiedAt).toBeNull();

    expect((await verify(code)).statusCode).toBe(200);
    expect((await me()).json().data.emailVerifiedAt).not.toBeNull();
  });

  it("is idempotent for an already verified address", async () => {
    const { code } = await registered();
    await verify(code);
    expect((await verify("000000")).statusCode).toBe(200);
  });

  it("rejects a wrong code and counts the attempt", async () => {
    const { code } = await registered();
    const wrong = code === "000000" ? "111111" : "000000";
    const res = await verify(wrong);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe("Invalid or expired code");
    expect((await otps("email_verification"))[0].attempts).toBe(1);
  });

  it("locks the code after 5 wrong guesses, even for the right code", async () => {
    const { code } = await registered();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await verify(wrong);
    expect((await verify(code)).statusCode).toBe(400);
  });

  it("rejects an expired code", async () => {
    const { code } = await registered();
    await app
      .knex("user_otps")
      .update({ expires_at: new Date(Date.now() - 1000) });
    expect((await verify(code)).statusCode).toBe(400);
  });

  it("answers an unknown email exactly like a wrong code", async () => {
    const { code } = await registered();
    const unknown = await verify(code, "ghost@example.com");
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().message).toBe("Invalid or expired code");
  });

  it("requires a 6-digit code", async () => {
    expect((await verify("12345")).statusCode).toBe(422);
    expect((await verify("abcdef")).statusCode).toBe(422);
  });

  it("resend replaces the old code with a new one", async () => {
    const { code: first } = await registered();
    transport.reset();
    expect(
      (await call("POST", "/api/auth/resend-verification", { email }))
        .statusCode,
    ).toBe(200);
    await flushMail(app);
    const second = transport.codeFor(email);

    if (first !== second) expect((await verify(first)).statusCode).toBe(400); // old code is dead
    expect((await verify(second)).statusCode).toBe(200);
  });

  it("resend answers the same for unknown and verified accounts, and sends nothing", async () => {
    const { code } = await registered();
    await verify(code);
    transport.reset();
    const known = await call("POST", "/api/auth/resend-verification", {
      email,
    });
    const unknown = await call("POST", "/api/auth/resend-verification", {
      email: "ghost@example.com",
    });
    await flushMail(app);
    expect(known.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(200);
    expect(known.json()).toEqual(unknown.json());
    expect(transport.sent).toHaveLength(0);
  });

  it("applies a resend cool-down", async () => {
    const slow = await buildApp(
      testConfig({ OTP_RESEND_COOLDOWN_SECONDS: "60" }),
      { mailTransport: transport },
    );
    try {
      await slow.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { fullName: "A", email, password },
      });
      await slow.inject({
        method: "POST",
        url: "/api/auth/resend-verification",
        payload: { email },
      });
      expect(await slow.knex("mail_outbox")).toHaveLength(1); // the resend was swallowed
    } finally {
      await slow.close();
    }
  });
});

describe("password reset", () => {
  it("answers the same for known and unknown emails; only the known one gets a mail", async () => {
    await register();
    await flushMail(app);
    transport.reset();

    const known = await forgot();
    const unknown = await forgot("ghost@example.com");
    await flushMail(app);

    expect(known.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(200);
    expect(known.json()).toEqual(unknown.json());
    expect(transport.sent.map((m) => m.to)).toEqual([email]);
    expect(transport.sent[0]!.subject).toContain("đặt lại mật khẩu");
  });

  async function requestedReset() {
    const { tokens } = await registered();
    await forgot();
    await flushMail(app);
    return { tokens, code: transport.codeFor(email) };
  }

  it("resets the password: old one dead, new one works", async () => {
    const { code } = await requestedReset();
    expect((await reset(code)).statusCode).toBe(200);
    expect(
      (await call("POST", "/api/auth/login", { email, password })).statusCode,
    ).toBe(401);
    expect(
      (
        await call("POST", "/api/auth/login", {
          email,
          password: "Brand-new-1",
        })
      ).statusCode,
    ).toBe(200);
  });

  it("signs out every existing session", async () => {
    const { tokens, code } = await requestedReset();
    await reset(code);
    const res = await call("POST", "/api/auth/refresh", {
      refreshToken: tokens.refreshToken,
    });
    expect(res.statusCode).toBe(401);
  });

  it("also proves mailbox ownership: the address becomes verified", async () => {
    const { code } = await requestedReset();
    await reset(code);
    const row = await app.knex("users").where({ email }).first();
    expect(row.email_verified_at).not.toBeNull();
  });

  it("works only once", async () => {
    const { code } = await requestedReset();
    expect((await reset(code)).statusCode).toBe(200);
    expect((await reset(code, "Another-pass-2")).statusCode).toBe(400);
  });

  it("counts wrong guesses and locks the code after 5", async () => {
    const { code } = await requestedReset();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++)
      expect((await reset(wrong)).statusCode).toBe(400);
    expect((await reset(code)).statusCode).toBe(400);
    expect((await otps("password_reset"))[0].attempts).toBe(5);
  });

  it("a newer code replaces the older one", async () => {
    const { code: first } = await requestedReset();
    await forgot();
    await flushMail(app);
    const second = transport.codeFor(email);
    if (first !== second) expect((await reset(first)).statusCode).toBe(400);
    expect((await reset(second)).statusCode).toBe(200);
  });

  it("a verification code cannot reset a password (codes are bound to their purpose)", async () => {
    const { code: verificationCode } = await registered();
    await forgot();
    await flushMail(app);
    const resetCode = transport.codeFor(email);
    if (verificationCode !== resetCode)
      expect((await reset(verificationCode)).statusCode).toBe(400);
  });

  it("refuses an expired code", async () => {
    const { code } = await requestedReset();
    await app
      .knex("user_otps")
      .where({ purpose: "password_reset" })
      .update({ expires_at: new Date(Date.now() - 1000) });
    expect((await reset(code)).statusCode).toBe(400);
  });

  it("does nothing for a locked account", async () => {
    await register();
    await flushMail(app);
    transport.reset();
    await app.knex("users").update({ status: "locked" });
    expect((await forgot()).statusCode).toBe(200);
    await flushMail(app);
    expect(transport.sent).toHaveLength(0);
  });

  it("validates the new password", async () => {
    const { code } = await requestedReset();
    expect((await reset(code, "short")).statusCode).toBe(422);
  });
});

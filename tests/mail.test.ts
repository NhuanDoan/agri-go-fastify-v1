import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  CaptureTransport,
  backdateUpdatedAt,
  resetDb,
  testConfig,
} from "./helpers.js";

let app: FastifyInstance;
const transport = new CaptureTransport();

beforeAll(async () => {
  app = await buildApp(testConfig(), { mailTransport: transport });
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb(app.knex);
  transport.reset();
});

const queue = (to: string, code = "123456") =>
  app.mail.enqueue(app.knex, {
    type: "email_verification",
    to,
    data: { fullName: "A", code, ttlMinutes: 10 },
  });
const rows = () => app.knex("mail_outbox").orderBy("id");
const makeDue = () =>
  app
    .knex("mail_outbox")
    .where({ status: "pending" })
    .update({ next_attempt_at: new Date(Date.now() - 1000) });

describe("mail outbox", () => {
  it("sends a queued mail and marks it sent", async () => {
    await queue("a@example.com");
    expect(await app.mail.processBatch()).toBe(1);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toMatchObject({
      to: "a@example.com",
      subject: "[AgriGo] Mã xác thực email",
    });
    const [row] = await rows();
    expect(row).toMatchObject({
      status: "sent",
      attempts: 1,
      last_error: null,
    });
    expect(row.sent_at).toBeInstanceOf(Date);
  });

  it("wipes the OTP code from the payload once the mail is sent", async () => {
    await queue("a@example.com", "987654");
    expect((await rows())[0].payload.code).toBe("987654"); // present while pending: it has to be
    await app.mail.processBatch();
    expect((await rows())[0].payload).toEqual({});
  });

  it("does not send the same mail twice", async () => {
    await queue("a@example.com");
    await app.mail.processBatch();
    expect(await app.mail.processBatch()).toBe(0);
    expect(transport.sent).toHaveLength(1);
  });

  it("is all-or-nothing with the caller transaction", async () => {
    await expect(
      app.knex.transaction(async (trx) => {
        await app.mail.enqueue(trx, {
          type: "email_verification",
          to: "ghost@example.com",
          data: { fullName: "G", code: "111111", ttlMinutes: 10 },
        });
        throw new Error("business change failed");
      }),
    ).rejects.toThrow("business change failed");
    expect(await rows()).toHaveLength(0); // no change, no mail
  });

  it("retries with backoff, then gives up and wipes the payload", async () => {
    transport.failWith = new Error("SMTP down");
    await queue("a@example.com");

    await app.mail.processBatch();
    let [row] = await rows();
    expect(row).toMatchObject({ status: "pending", attempts: 1 });
    expect(row.last_error).toContain("SMTP down");
    expect(row.next_attempt_at.getTime()).toBeGreaterThan(Date.now() + 30_000); // backoff, not "now"

    expect(await app.mail.processBatch()).toBe(0); // not due yet: untouched

    for (let i = 0; i < 4; i++) {
      await makeDue();
      await app.mail.processBatch();
    }
    [row] = await rows();
    expect(row).toMatchObject({ status: "failed", attempts: 5, payload: {} });

    transport.failWith = null;
    await app
      .knex("mail_outbox")
      .update({ next_attempt_at: new Date(Date.now() - 1000) });
    expect(await app.mail.processBatch()).toBe(0); // failed means failed
  });

  it("delivers after a transient failure", async () => {
    transport.failWith = new Error("blip");
    await queue("a@example.com");
    await app.mail.processBatch();
    transport.failWith = null;
    await makeDue();
    await app.mail.processBatch();
    expect(transport.sent).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("one bad recipient does not block the others", async () => {
    transport.failFor.add("b@example.com");
    for (const to of ["a@example.com", "b@example.com", "c@example.com"])
      await queue(to);
    await app.mail.processBatch();
    expect(transport.sent.map((m) => m.to)).toEqual([
      "a@example.com",
      "c@example.com",
    ]);
    const byTo = Object.fromEntries(
      (await rows()).map((r) => [r.to_email, r.status]),
    );
    expect(byTo).toEqual({
      "a@example.com": "sent",
      "b@example.com": "pending",
      "c@example.com": "sent",
    });
  });

  it("lets two workers share the queue without double sending (SKIP LOCKED)", async () => {
    for (let i = 0; i < 6; i++) await queue(`u${i}@example.com`);
    const handled = await Promise.all([
      app.mail.processBatch(3),
      app.mail.processBatch(3),
    ]);
    expect(handled.reduce((a, b) => a + b, 0)).toBe(6);
    const recipients = transport.sent.map((m) => m.to);
    expect(recipients).toHaveLength(6);
    expect(new Set(recipients).size).toBe(6); // nobody got it twice
  });

  it("purges old finished rows but keeps recent and pending ones", async () => {
    await queue("old@example.com");
    await queue("new@example.com");
    await queue("pending@example.com");
    await app.mail.processBatch(2); // old + new sent, pending stays

    // a plain UPDATE would be undone by the set_updated_at trigger, so disable it for this statement
    await backdateUpdatedAt(
      app.knex,
      "mail_outbox",
      { to_email: "old@example.com" },
      8 * 86_400_000,
    );

    expect(await app.mail.purgeOld()).toBe(1);
    expect((await rows()).map((r) => r.to_email).sort()).toEqual([
      "new@example.com",
      "pending@example.com",
    ]);
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type {
  MailMessage,
  MailTransport,
} from "../src/modules/mail/mail.types.js";
import { resetDb, testConfig } from "./helpers.js";

/** A transport the tests can pause, observe, and make fail. */
class ScriptedTransport implements MailTransport {
  sent: string[] = [];
  onSend: (message: MailMessage) => Promise<void> | void = () => {};

  async send(message: MailMessage): Promise<void> {
    await this.onSend(message);
    this.sent.push(message.to);
  }
}

const gate = () => {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => (open = resolve));
  return { wait, open };
};

let app: FastifyInstance;
const transport = new ScriptedTransport();

beforeAll(async () => {
  app = await buildApp(testConfig(), { mailTransport: transport });
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb(app.knex);
  transport.sent = [];
  transport.onSend = () => {};
});

const queue = (to: string) =>
  app.mail.enqueue(app.knex, {
    type: "email_verification",
    to,
    data: { fullName: "A", code: "123456", ttlMinutes: 10 },
  });
const row = (to: string) =>
  app.knex("mail_outbox").where({ to_email: to }).first();
const rows = () => app.knex("mail_outbox").orderBy("id");
const past = () => new Date(Date.now() - 1000);
const expireLeases = () =>
  app
    .knex("mail_outbox")
    .whereNotNull("lock_token")
    .update({ locked_until: past() });

describe("mail leases", () => {
  it("sends without holding a database row lock", async () => {
    let probe = "not run";
    let leaseSeen: Date | null = null;
    transport.onSend = async (message) => {
      const found = await app
        .knex("mail_outbox")
        .where({ to_email: message.to })
        .forUpdate()
        .noWait()
        .first();
      probe = found ? "lockable" : "missing";
      leaseSeen = found?.locked_until ?? null;
    };
    await queue("a@example.com");
    await app.mail.processBatch();

    expect(probe).toBe("lockable");
    expect(leaseSeen).toBeInstanceOf(Date);
    const ms = (leaseSeen as unknown as Date).getTime() - Date.now();
    expect(ms).toBeGreaterThan(100_000);
    expect(ms).toBeLessThan(125_000);
    expect(await row("a@example.com")).toMatchObject({
      status: "sent",
      attempts: 1,
      locked_until: null,
      lock_token: null,
    });
  });

  it("lets other workers proceed while one send is slow, without stealing its lease", async () => {
    const hold = gate();
    const started = gate();
    transport.onSend = async (message) => {
      if (message.to === "slow@example.com") {
        started.open();
        await hold.wait;
      }
    };
    await queue("slow@example.com");
    const slowWorker = app.mail.processBatch(1);
    await started.wait;

    await queue("fast@example.com");
    const t0 = Date.now();
    expect(await app.mail.processBatch(10)).toBe(1);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(transport.sent).toEqual(["fast@example.com"]);

    hold.open();
    await slowWorker;
    expect(transport.sent).toEqual([
      "fast@example.com",
      "slow@example.com",
    ]);
    expect((await rows()).every((mail) => mail.status === "sent")).toBe(true);
  });

  it("recovers a lease after the worker crashes", async () => {
    await queue("a@example.com");
    await app.knex("mail_outbox").update({
      locked_until: new Date(Date.now() + 60_000),
      lock_token: randomUUID(),
      attempts: 1,
    });
    expect(await app.mail.processBatch()).toBe(0);
    expect(transport.sent).toEqual([]);

    await app.knex("mail_outbox").update({ locked_until: past() });
    expect(await app.mail.processBatch()).toBe(1);
    expect(transport.sent).toEqual(["a@example.com"]);
    expect(await row("a@example.com")).toMatchObject({
      status: "sent",
      attempts: 2,
      locked_until: null,
      lock_token: null,
    });
  });

  it("prevents a stale worker from overwriting the new owner's success", async () => {
    const hold = gate();
    const started = gate();
    let first = true;
    transport.onSend = async () => {
      if (first) {
        first = false;
        started.open();
        await hold.wait;
      }
    };
    await queue("a@example.com");
    const stale = app.mail.processBatch(1);
    await started.wait;
    await expireLeases();

    expect(await app.mail.processBatch(1)).toBe(1);
    expect(await row("a@example.com")).toMatchObject({
      status: "sent",
      attempts: 2,
    });
    hold.open();
    await stale;
    expect(await row("a@example.com")).toMatchObject({
      status: "sent",
      attempts: 2,
    });
    expect(transport.sent).toEqual(["a@example.com", "a@example.com"]);
  });

  it("prevents a stale worker from replacing the new owner's failure or success", async () => {
    const hold = gate();
    const started = gate();
    let first = true;
    transport.onSend = async () => {
      if (first) {
        first = false;
        started.open();
        await hold.wait;
        throw new Error("smtp died late");
      }
    };
    await queue("a@example.com");
    const stale = app.mail.processBatch(1);
    await started.wait;
    await expireLeases();
    await app.mail.processBatch(1);

    hold.open();
    await stale;
    expect(await row("a@example.com")).toMatchObject({
      status: "sent",
      last_error: null,
    });
  });

  it("rechecks ownership before every send in a batch", async () => {
    const hold = gate();
    const started = gate();
    let first = true;
    transport.onSend = async () => {
      if (first) {
        first = false;
        started.open();
        await hold.wait;
      }
    };
    await queue("x@example.com");
    await queue("y@example.com");
    const stale = app.mail.processBatch(2);
    await started.wait;
    await expireLeases();

    expect(await app.mail.processBatch(2)).toBe(2);
    hold.open();
    await stale;
    expect(transport.sent).toEqual([
      "x@example.com",
      "y@example.com",
      "x@example.com",
    ]);
    expect(
      (await rows()).every(
        (mail) => mail.status === "sent" && mail.attempts === 2,
      ),
    ).toBe(true);
  });

  it("fails mail after repeated worker crashes and wipes the code payload", async () => {
    await queue("a@example.com");
    await app.knex("mail_outbox").update({
      attempts: 5,
      locked_until: past(),
      lock_token: randomUUID(),
    });

    expect(await app.mail.processBatch()).toBe(0);
    expect(transport.sent).toEqual([]);
    expect(await row("a@example.com")).toMatchObject({
      status: "failed",
      payload: {},
      lock_token: null,
      locked_until: null,
    });
    expect((await row("a@example.com")).last_error).toMatch(/crashing/);
  });
});

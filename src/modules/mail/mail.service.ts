import type { FastifyBaseLogger } from "fastify";
import type { Knex } from "knex";
import { randomUUID } from "node:crypto";
import type { Db } from "../../common/utils/db.js";
import type { MailOutboxRepository } from "./mail.outbox.repository.js";
import { renderMail } from "./mail.templates.js";
import type {
  MailOutboxRow,
  MailTransport,
  OutgoingMail,
} from "./mail.types.js";

const MAX_ATTEMPTS = 5;
const KEEP_FINISHED_DAYS = 7;

/**
 * Delivery is AT-LEAST-ONCE. If a worker dies after SMTP accepted a message but before we recorded it, the lease
 * expires and the mail is sent again. For codes and receipts that is the right trade: a duplicate beats a lost mail.
 */
export class MailService {
  constructor(
    private readonly knex: Knex,
    private readonly outbox: MailOutboxRepository,
    private readonly transport: MailTransport,
    private readonly appName: string,
    private readonly log: FastifyBaseLogger,
    /** Must exceed the longest single send (SMTP connection + socket timeouts = 30 s). */
    private readonly leaseSeconds: number,
  ) {}

  /** Queue a mail in the CALLER'S transaction: it exists if and only if the business change commits. */
  enqueue(db: Db, mail: OutgoingMail): Promise<void> {
    return this.outbox.enqueue(db, mail.type, mail.to, mail.data);
  }

  /** One worker tick. Returns how many mails it claimed. */
  async processBatch(limit = 10): Promise<number> {
    await this.outbox.failExhausted(this.knex, MAX_ATTEMPTS);
    const token = randomUUID();
    const rows = await this.outbox.claim(
      this.knex,
      limit,
      this.leaseSeconds,
      MAX_ATTEMPTS,
      token,
    );
    for (const row of rows) await this.deliver(row, token);
    return rows.length;
  }

  private async deliver(row: MailOutboxRow, token: string): Promise<void> {
    // Renew right before the send: one lease then only has to cover ONE send, not a whole batch,
    // and a worker that already lost this mail skips it instead of sending a duplicate.
    if (
      !(await this.outbox.renew(this.knex, row.id, token, this.leaseSeconds))
    ) {
      this.log.warn(
        { mailId: row.id },
        "mail lease lost before sending; another worker owns it now",
      );
      return;
    }
    try {
      const rendered = renderMail(this.appName, {
        type: row.type,
        to: row.to_email,
        data: row.payload,
      } as OutgoingMail);
      await this.transport.send({ to: row.to_email, ...rendered });
      if (!(await this.outbox.markSent(this.knex, row.id, token))) {
        this.log.warn(
          { mailId: row.id },
          "mail sent, but its lease had expired: another worker may send it again",
        );
      }
    } catch (err) {
      // row.attempts already counts this attempt (it was counted at claim time)
      const retryAt =
        row.attempts >= MAX_ATTEMPTS
          ? null
          : new Date(
              Date.now() + Math.min(30_000 * 2 ** row.attempts, 3_600_000),
            );
      this.log.warn(
        {
          err,
          mailId: row.id,
          attempts: row.attempts,
          giveUp: retryAt === null,
        },
        "mail send failed",
      );
      if (
        !(await this.outbox.markFailed(
          this.knex,
          row.id,
          token,
          String(err),
          retryAt,
        ))
      ) {
        this.log.warn(
          { mailId: row.id },
          "mail failed after its lease expired; the new owner decides its fate",
        );
      }
    }
  }

  purgeOld(): Promise<number> {
    return this.outbox.deleteFinishedBefore(
      this.knex,
      new Date(Date.now() - KEEP_FINISHED_DAYS * 86_400_000),
    );
  }
}

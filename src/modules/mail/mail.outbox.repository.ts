import type { Db } from "../../common/utils/db.js";
import type { MailOutboxRow } from "./mail.types.js";

export class MailOutboxRepository {
  async enqueue(
    db: Db,
    type: string,
    to: string,
    payload: object,
  ): Promise<void> {
    await db("mail_outbox").insert({ type, to_email: to, payload });
  }

  /**
   * ONE atomic statement: pick due mails nobody holds, lease them to THIS worker, and count the attempt.
   * SKIP LOCKED lets concurrent workers take different rows. Afterwards NOTHING is locked: the lease (a timestamp
   * plus our token) is what keeps other workers away while we talk to SMTP, so no transaction is open during a send.
   * Counting the attempt at claim time means a mail that keeps crashing workers still runs out of attempts.
   */
  async claim(
    db: Db,
    limit: number,
    leaseSeconds: number,
    maxAttempts: number,
    token: string,
  ): Promise<MailOutboxRow[]> {
    const result = await db.raw(
      `UPDATE mail_outbox
          SET locked_until = now() + make_interval(secs => ?), lock_token = ?, attempts = attempts + 1
        WHERE id IN (
          SELECT id FROM mail_outbox
           WHERE status = 'pending' AND next_attempt_at <= now()
             AND (locked_until IS NULL OR locked_until < now())
             AND attempts < ?
           ORDER BY id
           LIMIT ?
           FOR UPDATE SKIP LOCKED
        )
        RETURNING *`,
      [leaseSeconds, token, maxAttempts, limit],
    );
    return (result.rows as MailOutboxRow[]).sort((a, b) => a.id - b.id);
  }

  /** Extend the lease right before a send. False = it is no longer ours (it expired and another worker took it). */
  async renew(
    db: Db,
    id: number,
    token: string,
    leaseSeconds: number,
  ): Promise<boolean> {
    const n = await db("mail_outbox")
      .where({ id, lock_token: token })
      .update({
        locked_until: db.raw("now() + make_interval(secs => ?)", [
          leaseSeconds,
        ]),
      });
    return n === 1;
  }

  /** The payload (which contains the OTP code) is wiped as soon as the mail is gone. False = we lost the lease. */
  async markSent(db: Db, id: number, token: string): Promise<boolean> {
    const n = await db("mail_outbox")
      .where({ id, lock_token: token })
      .update({
        status: "sent",
        sent_at: new Date(),
        last_error: null,
        payload: {},
        locked_until: null,
        lock_token: null,
      });
    return n === 1;
  }

  /** retryAt = null means "give up": the row becomes `failed` and its payload is wiped. False = we lost the lease. */
  async markFailed(
    db: Db,
    id: number,
    token: string,
    error: string,
    retryAt: Date | null,
  ): Promise<boolean> {
    const base = {
      last_error: error.slice(0, 1000),
      locked_until: null,
      lock_token: null,
    };
    const n = await db("mail_outbox")
      .where({ id, lock_token: token })
      .update(
        retryAt
          ? { ...base, next_attempt_at: retryAt }
          : { ...base, status: "failed", payload: {} },
      );
    return n === 1;
  }

  /** A mail whose attempts ran out while a worker kept crashing on it: stop, and wipe the code. */
  async failExhausted(db: Db, maxAttempts: number): Promise<number> {
    return db("mail_outbox")
      .where({ status: "pending" })
      .where("attempts", ">=", maxAttempts)
      .where((qb) =>
        qb.whereNull("locked_until").orWhere("locked_until", "<", db.fn.now()),
      )
      .update({
        status: "failed",
        payload: {},
        locked_until: null,
        lock_token: null,
        last_error: db.raw(
          "COALESCE(last_error, 'gave up: the worker kept crashing on this mail')",
        ),
      });
  }

  async deleteFinishedBefore(db: Db, cutoff: Date): Promise<number> {
    return db("mail_outbox")
      .whereIn("status", ["sent", "failed"])
      .where("updated_at", "<", cutoff)
      .delete();
  }
}

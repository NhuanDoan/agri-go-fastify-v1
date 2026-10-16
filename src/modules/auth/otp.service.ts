import type { Knex } from "knex";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { Db } from "../../common/utils/db.js";
import type { OtpPurpose } from "./auth.types.js";
import type { OtpRepository } from "./otp.repository.js";

const MAX_ATTEMPTS = 5;

/**
 * 6-digit codes. Only HMAC(secret, userId:purpose:code) is stored: a leaked table cannot be
 * brute-forced offline (a million possibilities are trivial WITHOUT the secret, hopeless with it).
 * Online guessing is capped at 5 tries per code.
 */
export class OtpService {
  constructor(
    private readonly knex: Knex,
    private readonly repo: OtpRepository,
    private readonly secret: string,
    readonly ttlMinutes: number,
    private readonly cooldownSeconds: number,
  ) {}

  private digest(userId: number, purpose: OtpPurpose, code: string): Buffer {
    return createHmac("sha256", this.secret)
      .update(`${userId}:${purpose}:${code}`)
      .digest();
  }

  /** Returns the plain code to mail out, or null while the resend cool-down is running. */
  async issue(
    db: Db,
    userId: number,
    purpose: OtpPurpose,
  ): Promise<string | null> {
    if (this.cooldownSeconds > 0) {
      const last = await this.repo.lastCreatedAt(db, userId, purpose);
      if (last && Date.now() - last.getTime() < this.cooldownSeconds * 1000)
        return null;
    }
    await this.repo.invalidateActive(db, userId, purpose);

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0"); // crypto-grade, not Math.random
    await this.repo.create(db, {
      user_id: userId,
      purpose,
      code_hash: this.digest(userId, purpose, code).toString("hex"),
      expires_at: new Date(Date.now() + this.ttlMinutes * 60_000),
    });
    return code;
  }

  /**
   * Runs in its OWN transaction on purpose: a wrong guess must COMMIT its attempt counter
   * even though the caller then answers with an error.
   */
  verify(userId: number, purpose: OtpPurpose, code: string): Promise<boolean> {
    return this.knex.transaction(async (trx) => {
      const otp = await this.repo.latestActiveForUpdate(trx, userId, purpose);
      if (
        !otp ||
        otp.expires_at.getTime() <= Date.now() ||
        otp.attempts >= MAX_ATTEMPTS
      )
        return false;

      const expected = Buffer.from(otp.code_hash, "hex");
      const actual = this.digest(userId, purpose, code);
      if (
        expected.length !== actual.length ||
        !timingSafeEqual(expected, actual)
      ) {
        await this.repo.incrementAttempts(trx, otp.id);
        return false;
      }
      await this.repo.consume(trx, otp.id); // single use
      return true;
    });
  }

  purgeExpired(): Promise<number> {
    return this.repo.deleteExpiredBefore(
      this.knex,
      new Date(Date.now() - 24 * 3_600_000),
    );
  }
}

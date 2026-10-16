import type { Db } from "../../common/utils/db.js";
import type { OtpPurpose, OtpRow } from "./auth.types.js";

export class OtpRepository {
  async lastCreatedAt(
    db: Db,
    userId: number,
    purpose: OtpPurpose,
  ): Promise<Date | undefined> {
    const row = await db("user_otps")
      .where({ user_id: userId, purpose })
      .orderBy("id", "desc")
      .first("created_at");
    return row?.created_at;
  }

  /** At most one live code per user and purpose: issuing a new one kills the old one. */
  async invalidateActive(
    db: Db,
    userId: number,
    purpose: OtpPurpose,
  ): Promise<void> {
    await db("user_otps")
      .where({ user_id: userId, purpose })
      .whereNull("consumed_at")
      .update({ consumed_at: new Date() });
  }

  async create(
    db: Db,
    data: {
      user_id: number;
      purpose: OtpPurpose;
      code_hash: string;
      expires_at: Date;
    },
  ): Promise<void> {
    await db("user_otps").insert(data);
  }

  latestActiveForUpdate(
    db: Db,
    userId: number,
    purpose: OtpPurpose,
  ): Promise<OtpRow | undefined> {
    return db("user_otps")
      .where({ user_id: userId, purpose })
      .whereNull("consumed_at")
      .orderBy("id", "desc")
      .forUpdate()
      .first();
  }

  async incrementAttempts(db: Db, id: number): Promise<void> {
    await db("user_otps").where({ id }).increment("attempts", 1);
  }

  async consume(db: Db, id: number): Promise<void> {
    await db("user_otps").where({ id }).update({ consumed_at: new Date() });
  }

  deleteExpiredBefore(db: Db, cutoff: Date): Promise<number> {
    return db("user_otps").where("expires_at", "<", cutoff).delete();
  }
}

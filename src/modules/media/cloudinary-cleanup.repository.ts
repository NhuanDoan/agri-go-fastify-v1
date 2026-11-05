import type { Knex } from "knex";
import type { CloudinaryCleanupRow } from "./media.types.js";

export class CloudinaryCleanupRepository {
  constructor(private readonly db: Knex) {}

  async enqueue(db: Knex | Knex.Transaction, publicId: string): Promise<void> {
    await db("cloudinary_cleanup")
      .insert({ public_id: publicId })
      .onConflict("public_id")
      .ignore();
  }

  enqueueStandalone(publicId: string): Promise<void> {
    return this.enqueue(this.db, publicId);
  }

  async claim(
    limit: number,
    leaseSeconds: number,
    token: string,
  ): Promise<CloudinaryCleanupRow[]> {
    return this.db.transaction(async (trx) => {
      const rows = await trx<CloudinaryCleanupRow>("cloudinary_cleanup")
        .where("available_at", "<=", trx.fn.now())
        .where((q) =>
          q.whereNull("locked_until").orWhere("locked_until", "<", trx.fn.now()),
        )
        .orderBy("id")
        .forUpdate()
        .skipLocked()
        .limit(limit);
      if (rows.length === 0) return [];
      await trx("cloudinary_cleanup")
        .whereIn(
          "id",
          rows.map((row) => row.id),
        )
        .update({
          attempts: trx.raw("attempts + 1"),
          locked_until: trx.raw("now() + (? * interval '1 second')", [
            leaseSeconds,
          ]),
          lock_token: token,
        });
      return rows.map((row) => ({
        ...row,
        attempts: row.attempts + 1,
      }));
    });
  }

  deleteClaimed(id: number, token: string): Promise<number> {
    return this.db("cloudinary_cleanup")
      .where({ id, lock_token: token })
      .delete();
  }

  failClaimed(
    id: number,
    token: string,
    error: string,
    retryAt: Date | null,
  ): Promise<number> {
    return this.db("cloudinary_cleanup")
      .where({ id, lock_token: token })
      .update({
        last_error: error,
        available_at: retryAt ?? new Date("9999-12-31T00:00:00.000Z"),
        locked_until: null,
        lock_token: null,
      });
  }
}

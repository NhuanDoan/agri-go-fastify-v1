import type { Knex } from "knex";
import type { RefreshTokenRow } from "./auth.types.js";

export type NewRefreshToken = Pick<
  RefreshTokenRow,
  | "id"
  | "user_id"
  | "family_id"
  | "token_hash"
  | "expires_at"
  | "user_agent"
  | "ip"
>;

export class AuthRepository {
  constructor(private readonly db: Knex) {}

  private t(trx?: Knex.Transaction) {
    return (trx ?? this.db)<RefreshTokenRow>("refresh_tokens");
  }

  async create(data: NewRefreshToken, trx?: Knex.Transaction): Promise<void> {
    await this.t(trx).insert(data);
  }

  /** Row lock: two concurrent refreshes of the same token serialize here. */
  findByIdForUpdate(
    id: string,
    trx: Knex.Transaction,
  ): Promise<RefreshTokenRow | undefined> {
    return this.t(trx).where({ id }).forUpdate().first();
  }

  async markRotated(
    id: string,
    replacedBy: string,
    trx: Knex.Transaction,
  ): Promise<void> {
    await this.t(trx)
      .where({ id })
      .update({ revoked_at: new Date(), replaced_by: replacedBy });
  }

  async revokeFamily(familyId: string, trx?: Knex.Transaction): Promise<void> {
    await this.t(trx)
      .where({ family_id: familyId })
      .whereNull("revoked_at")
      .update({ revoked_at: new Date() });
  }

  async revokeAllForUser(
    userId: number,
    trx?: Knex.Transaction,
  ): Promise<void> {
    await this.t(trx)
      .where({ user_id: userId })
      .whereNull("revoked_at")
      .update({ revoked_at: new Date() });
  }

  /** Housekeeping: a scheduled job will call this in Step 6. */
  deleteExpired(): Promise<number> {
    return this.t().where("expires_at", "<", new Date()).delete();
  }
}

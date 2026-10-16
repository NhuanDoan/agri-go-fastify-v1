import type { Knex } from "knex";
import { firstId, likeTerm } from "../../common/utils/db.js";
import { toOffset, type Paged } from "../../common/utils/pagination.js";
import type { UserFilter, UserRow } from "./users.types.js";

export type NewUser = Pick<
  UserRow,
  "full_name" | "email" | "password_hash" | "role" | "status"
> &
  Partial<Pick<UserRow, "phone" | "email_verified_at">>;

/** SQL only: no business rules, no HTTP. Every method can join a transaction. */
export class UsersRepository {
  constructor(private readonly db: Knex) {}

  private t(trx?: Knex.Transaction) {
    return (trx ?? this.db)<UserRow>("users");
  }

  findById(id: number, trx?: Knex.Transaction): Promise<UserRow | undefined> {
    return this.t(trx).where({ id }).first();
  }

  /** Case-insensitive: matches the lower(email) unique index. */
  findByEmail(
    email: string,
    trx?: Knex.Transaction,
  ): Promise<UserRow | undefined> {
    return this.t(trx)
      .whereRaw("lower(email) = ?", [email.toLowerCase()])
      .first();
  }

  async list(f: UserFilter): Promise<Paged<UserRow>> {
    const apply = (qb: Knex.QueryBuilder) => {
      if (f.q) {
        const term = likeTerm(f.q);
        qb.where((b) =>
          b.whereILike("full_name", term).orWhereILike("email", term),
        );
      }
      if (f.role) qb.where("role", f.role);
      if (f.status) qb.where("status", f.status);
    };
    const [items, countRow] = await Promise.all([
      this.t()
        .modify(apply)
        .orderBy("id", "desc")
        .limit(f.perPage)
        .offset(toOffset(f.page, f.perPage)),
      this.t().modify(apply).count({ total: "*" }).first(),
    ]);
    const total = Number(
      (countRow as unknown as { total?: number | string } | undefined)?.total ??
        0,
    );
    return { items: items as UserRow[], total };
  }

  create(data: NewUser, trx?: Knex.Transaction): Promise<number> {
    return firstId(this.t(trx).insert(data).returning("id"));
  }

  async update(
    id: number,
    data: Partial<Omit<UserRow, "id">>,
    trx?: Knex.Transaction,
  ): Promise<void> {
    await this.t(trx).where({ id }).update(data);
  }

  async delete(id: number, trx?: Knex.Transaction): Promise<void> {
    await this.t(trx).where({ id }).delete();
  }
}

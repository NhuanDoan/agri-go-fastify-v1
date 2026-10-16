import type { Knex } from "knex";
import { firstId, likeTerm } from "../../common/utils/db.js";
import { toOffset, type Paged } from "../../common/utils/pagination.js";
import type { CategoryRow } from "./categories.types.js";

export class CategoriesRepository {
  constructor(private readonly db: Knex) {}

  private t(trx?: Knex.Transaction) {
    return (trx ?? this.db)<CategoryRow>("categories");
  }

  findById(id: number): Promise<CategoryRow | undefined> {
    return this.t().where({ id }).first();
  }

  findByName(name: string): Promise<CategoryRow | undefined> {
    return this.t().whereRaw("lower(name) = ?", [name.toLowerCase()]).first();
  }

  async slugExists(slug: string, excludeId?: number): Promise<boolean> {
    const q = this.t().where({ slug });
    if (excludeId) q.whereNot({ id: excludeId });
    return Boolean(await q.first());
  }

  async list(
    page: number,
    perPage: number,
    q?: string,
  ): Promise<Paged<CategoryRow>> {
    const apply = (qb: Knex.QueryBuilder) => {
      if (q) qb.whereILike("name", likeTerm(q));
    };
    const [items, countRow] = await Promise.all([
      this.t()
        .modify(apply)
        .orderByRaw("LOWER(??) ASC, ?? ASC", ["name", "id"])
        .limit(perPage)
        .offset(toOffset(page, perPage)),
      this.t().modify(apply).count({ total: "*" }).first(),
    ]);
    const total = Number(
      (countRow as unknown as { total?: number | string } | undefined)?.total ??
        0,
    );
    return { items: items as CategoryRow[], total };
  }

  create(
    data: Pick<CategoryRow, "name" | "slug" | "description">,
  ): Promise<number> {
    return firstId(this.t().insert(data).returning("id"));
  }

  async update(
    id: number,
    data: Partial<Omit<CategoryRow, "id">>,
  ): Promise<void> {
    await this.t().where({ id }).update(data);
  }

  async delete(id: number): Promise<void> {
    await this.t().where({ id }).delete();
  }

  /** ALL products, soft-deleted ones included: the foreign key counts them too. */
  async countProducts(id: number): Promise<number> {
    const row = await this.db("products")
      .where({ category_id: id })
      .count({ total: "*" })
      .first();
    return Number(
      (row as unknown as { total?: number | string } | undefined)?.total ?? 0,
    );
  }
}

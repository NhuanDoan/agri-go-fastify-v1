import type { Knex } from "knex";
import { firstId, likeTerm } from "../../common/utils/db.js";
import { toOffset, type Paged } from "../../common/utils/pagination.js";
import type {
  ProductFilter,
  ProductRow,
  ProductSort,
  ProductWithCategory,
} from "./products.types.js";

const ORDER: Record<ProductSort, [string, string[]]> = {
  newest: ["?? DESC", ["p.id"]],
  price_asc: ["?? ASC, ?? DESC", ["p.price", "p.id"]],
  price_desc: ["?? DESC, ?? DESC", ["p.price", "p.id"]],
  name: ["LOWER(??) ASC, ?? ASC", ["p.name", "p.id"]], // was DESC
};

export type NewProduct = Pick<
  ProductRow,
  | "category_id"
  | "name"
  | "slug"
  | "description"
  | "price"
  | "quantity"
  | "unit"
  | "status"
>;

/** Soft-deleted products (deleted_at set) are invisible here; old orders still point at them. */
export class ProductsRepository {
  constructor(private readonly db: Knex) {}

  private joined(trx?: Knex.Transaction) {
    return (trx ?? this.db)("products as p")
      .join("categories as c", "c.id", "p.category_id")
      .whereNull("p.deleted_at");
  }

  private columns = [
    "p.*",
    "c.name as category_name",
    "c.slug as category_slug",
  ];

  async list(f: ProductFilter): Promise<Paged<ProductWithCategory>> {
    const apply = (qb: Knex.QueryBuilder) => {
      if (f.q) qb.whereILike("p.name", likeTerm(f.q));
      if (f.categoryId) qb.where("p.category_id", f.categoryId);
      if (f.status) qb.where("p.status", f.status);
      if (f.minPrice !== undefined) qb.where("p.price", ">=", f.minPrice);
      if (f.maxPrice !== undefined) qb.where("p.price", "<=", f.maxPrice);
    };

    const [sql, bindings] = ORDER[f.sort ?? "newest"];

    const [items, countRow] = await Promise.all([
      this.joined()
        .modify(apply)
        .select(this.columns)
        .orderByRaw(sql, bindings)
        .limit(f.perPage)
        .offset(toOffset(f.page, f.perPage)),
      this.joined().modify(apply).count({ total: "p.id" }).first(),
    ]);
    const total = Number(
      (countRow as unknown as { total?: number | string } | undefined)?.total ??
        0,
    );
    return { items: items as ProductWithCategory[], total };
  }

  async findById(id: number): Promise<ProductWithCategory | undefined> {
    return (await this.joined()
      .where("p.id", id)
      .select(this.columns)
      .first()) as ProductWithCategory | undefined;
  }

  /** `SELECT ... FOR UPDATE`: take it before changing stock. */
  findByIdForUpdate(
    id: number,
    trx: Knex.Transaction,
  ): Promise<ProductRow | undefined> {
    return trx<ProductRow>("products")
      .where({ id })
      .whereNull("deleted_at")
      .forUpdate()
      .first();
  }

  async slugExists(slug: string): Promise<boolean> {
    // includes soft-deleted rows: the unique index does too
    return Boolean(await this.db("products").where({ slug }).first());
  }

  create(data: NewProduct, trx?: Knex.Transaction): Promise<number> {
    return firstId((trx ?? this.db)("products").insert(data).returning("id"));
  }

  async update(
    id: number,
    data: Partial<Omit<ProductRow, "id">>,
    trx?: Knex.Transaction,
  ): Promise<void> {
    await (trx ?? this.db)("products")
      .where({ id })
      .whereNull("deleted_at")
      .update(data);
  }

  async softDelete(id: number): Promise<void> {
    await this.db("products")
      .where({ id })
      .update({ deleted_at: new Date(), status: "inactive" });
  }
}

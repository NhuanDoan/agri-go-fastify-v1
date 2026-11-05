import type { Knex } from "knex";
import type { ProductImageRow } from "./products.types.js";

export class ProductImagesRepository {
  constructor(private readonly db: Knex) {}

  listByProductIds(productIds: number[]): Promise<ProductImageRow[]> {
    if (productIds.length === 0) return Promise.resolve([]);
    return this.db<ProductImageRow>("product_images")
      .whereIn("product_id", productIds)
      .orderBy([{ column: "sort_order", order: "asc" }, { column: "id", order: "asc" }]);
  }

  findById(productId: number, id: number, trx?: Knex.Transaction) {
    return (trx ?? this.db)<ProductImageRow>("product_images")
      .where({ product_id: productId, id })
      .first();
  }

  async add(
    data: Pick<ProductImageRow, "product_id" | "image_url" | "public_id" | "is_primary" | "sort_order">,
    trx?: Knex.Transaction,
  ): Promise<ProductImageRow> {
    const query = trx ?? this.db;
    return query<ProductImageRow>("product_images")
      .insert(data)
      .returning("*")
      .then((rows) => rows[0]!);
  }

  async update(id: number, data: Partial<ProductImageRow>, trx?: Knex.Transaction) {
    await (trx ?? this.db)("product_images").where({ id }).update(data);
  }

  async delete(id: number, trx?: Knex.Transaction): Promise<void> {
    await (trx ?? this.db)("product_images").where({ id }).delete();
  }
}

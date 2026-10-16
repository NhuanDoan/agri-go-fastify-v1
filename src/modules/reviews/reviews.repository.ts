import type { Db } from "../../common/utils/db.js";
import { firstId } from "../../common/utils/db.js";
import { toOffset, type Paged } from "../../common/utils/pagination.js";
import type { ReviewRow, ReviewWithUser } from "./reviews.types.js";

export class ReviewsRepository {
  private withUser(db: Db) {
    return db("reviews as r")
      .join("users as u", "u.id", "r.user_id")
      .select(
        "r.*",
        "u.full_name as user_full_name",
        "u.avatar_url as user_avatar_url",
      );
  }

  async listByProduct(
    db: Db,
    productId: number,
    page: number,
    perPage: number,
  ): Promise<Paged<ReviewWithUser>> {
    const [items, countRow] = await Promise.all([
      this.withUser(db)
        .where("r.product_id", productId)
        .orderBy("r.id", "desc")
        .limit(perPage)
        .offset(toOffset(page, perPage)),
      db("reviews")
        .where({ product_id: productId })
        .count({ total: "*" })
        .first(),
    ]);
    return {
      items: items as ReviewWithUser[],
      total: Number((countRow as { total?: number })?.total ?? 0),
    };
  }

  /** One row per rating that exists: the service fills in the zeros. */
  async ratingCounts(
    db: Db,
    productId: number,
  ): Promise<{ rating: number; total: number }[]> {
    return db("reviews")
      .where({ product_id: productId })
      .groupBy("rating")
      .select("rating")
      .count({ total: "*" });
  }

  async findWithUser(db: Db, id: number): Promise<ReviewWithUser | undefined> {
    return this.withUser(db).where("r.id", id).first();
  }

  async findById(db: Db, id: number): Promise<ReviewRow | undefined> {
    return db("reviews").where({ id }).first();
  }

  async findByUserAndProduct(
    db: Db,
    userId: number,
    productId: number,
  ): Promise<ReviewRow | undefined> {
    return db("reviews")
      .where({ user_id: userId, product_id: productId })
      .first();
  }

  /** Verified purchase: a COMPLETED order of this user that contains the product. */
  async hasPurchased(
    db: Db,
    userId: number,
    productId: number,
  ): Promise<boolean> {
    const row = await db("order_details as d")
      .join("orders as o", "o.id", "d.order_id")
      .where({
        "o.user_id": userId,
        "d.product_id": productId,
        "o.order_status": "completed",
      })
      .first("d.id");
    return Boolean(row);
  }

  create(
    db: Db,
    data: Pick<ReviewRow, "user_id" | "product_id" | "rating" | "comment">,
  ): Promise<number> {
    return firstId(db("reviews").insert(data).returning("id"));
  }

  async update(db: Db, id: number, patch: Partial<ReviewRow>): Promise<void> {
    await db("reviews").where({ id }).update(patch);
  }

  async delete(db: Db, id: number): Promise<void> {
    await db("reviews").where({ id }).delete();
  }
}

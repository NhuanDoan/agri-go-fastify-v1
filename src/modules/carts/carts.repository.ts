import type { Db } from "../../common/utils/db.js";
import type { CartLineRow, CartRow } from "./carts.types.js";

export class CartsRepository {
  /** One cart per user (UNIQUE user_id). Race-safe: concurrent first requests create exactly one. */
  async getOrCreate(db: Db, userId: number): Promise<CartRow> {
    await db("carts")
      .insert({ user_id: userId })
      .onConflict("user_id")
      .ignore();
    return db("carts").where({ user_id: userId }).first();
  }

  /** Serializes concurrent checkouts of the same cart. Must run inside a transaction. */
  async lock(db: Db, cartId: number): Promise<void> {
    await db("carts").where({ id: cartId }).forUpdate().select("id");
  }

  /** Includes soft-deleted products on purpose: the cart shows them as unavailable instead of silently dropping them. */
  async lines(db: Db, cartId: number): Promise<CartLineRow[]> {
    return db("cart_items as ci")
      .join("products as p", "p.id", "ci.product_id")
      .where("ci.cart_id", cartId)
      .orderBy("ci.id")
      .select(
        "ci.product_id",
        "ci.quantity",
        "p.name",
        "p.unit",
        "p.price",
        "p.status",
        "p.quantity as stock",
        "p.deleted_at",
      );
  }

  async findItem(
    db: Db,
    cartId: number,
    productId: number,
  ): Promise<{ quantity: number } | undefined> {
    return db("cart_items")
      .where({ cart_id: cartId, product_id: productId })
      .first("quantity");
  }

  async setItem(
    db: Db,
    cartId: number,
    productId: number,
    quantity: number,
  ): Promise<void> {
    await db("cart_items")
      .insert({ cart_id: cartId, product_id: productId, quantity })
      .onConflict(["cart_id", "product_id"])
      .merge(["quantity"]);
  }

  async removeItem(db: Db, cartId: number, productId: number): Promise<void> {
    await db("cart_items")
      .where({ cart_id: cartId, product_id: productId })
      .delete();
  }

  async clear(db: Db, cartId: number): Promise<void> {
    await db("cart_items").where({ cart_id: cartId }).delete();
  }
}

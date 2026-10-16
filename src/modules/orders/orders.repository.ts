import type { Knex } from "knex";
import type { Db } from "../../common/utils/db.js";
import { firstId } from "../../common/utils/db.js";
import { toOffset, type Paged } from "../../common/utils/pagination.js";
import type {
  OrderDetailRow,
  OrderFilter,
  OrderRow,
  ProductLock,
} from "./orders.types.js";

export type NewOrder = Pick<
  OrderRow,
  | "order_code"
  | "user_id"
  | "subtotal"
  | "shipping_fee"
  | "total_price"
  | "payment_method"
  | "receiver_name"
  | "receiver_phone"
  | "shipping_address"
  | "note"
>;

export type NewOrderDetail = Pick<
  OrderDetailRow,
  "order_id" | "product_id" | "product_name" | "unit" | "quantity" | "price"
>;

/** Stateless: every method takes the Db (pool or transaction), so the SERVICE owns the transaction boundary. */
export class OrdersRepository {
  /**
   * Lock product rows in ASCENDING id order. Two checkouts that touch the same products then always
   * queue up in the same order, so they can never deadlock each other.
   */
  async lockProducts(db: Db, ids: number[]): Promise<ProductLock[]> {
    return db("products")
      .whereIn("id", ids)
      .whereNull("deleted_at")
      .orderBy("id")
      .forUpdate()
      .select("id", "name", "unit", "price", "quantity", "status");
  }

  /** Same lock, soft-deleted products included: a cancelled order must still be able to restock them. */
  async lockProductsIncludingDeleted(db: Db, ids: number[]): Promise<void> {
    await db("products")
      .whereIn("id", ids)
      .orderBy("id")
      .forUpdate()
      .select("id");
  }

  /** Relative update (quantity + delta), returns the new stock. CHECK (quantity >= 0) is the safety net. */
  async adjustStock(db: Db, productId: number, delta: number): Promise<number> {
    const [row] = await db("products")
      .where({ id: productId })
      .update({ quantity: db.raw("quantity + ?", [delta]) })
      .returning("quantity");
    return (row as { quantity: number }).quantity;
  }

  insert(db: Db, data: NewOrder): Promise<number> {
    return firstId(db("orders").insert(data).returning("id"));
  }

  async insertDetails(db: Db, rows: NewOrderDetail[]): Promise<void> {
    await db("order_details").insert(rows); // subtotal is a generated column: never inserted
  }

  async findById(db: Db, id: number): Promise<OrderRow | undefined> {
    return db("orders").where({ id }).first();
  }

  async findByIdForUpdate(db: Db, id: number): Promise<OrderRow | undefined> {
    return db("orders").where({ id }).forUpdate().first();
  }

  async details(db: Db, orderIds: number[]): Promise<OrderDetailRow[]> {
    if (orderIds.length === 0) return [];
    return db("order_details").whereIn("order_id", orderIds).orderBy("id");
  }

  async list(db: Db, f: OrderFilter): Promise<Paged<OrderRow>> {
    const apply = (qb: Knex.QueryBuilder) => {
      if (f.userId) qb.where("user_id", f.userId);
      if (f.orderStatus) qb.where("order_status", f.orderStatus);
      if (f.paymentStatus) qb.where("payment_status", f.paymentStatus);
    };
    const [items, countRow] = await Promise.all([
      db("orders")
        .modify(apply)
        .orderBy("id", "desc")
        .limit(f.perPage)
        .offset(toOffset(f.page, f.perPage)),
      db("orders").modify(apply).count({ total: "*" }).first(),
    ]);
    return {
      items: items as OrderRow[],
      total: Number((countRow as { total?: number })?.total ?? 0),
    };
  }

  async update(db: Db, id: number, patch: Partial<OrderRow>): Promise<void> {
    await db("orders").where({ id }).update(patch);
  }

  async addHistory(
    db: Db,
    h: {
      order_id: number;
      from_status: string | null;
      to_status: string;
      note?: string | null;
      changed_by?: number | null;
    },
  ): Promise<void> {
    await db("order_status_histories").insert({
      note: null,
      changed_by: null,
      ...h,
    });
  }

  /**
   * Unpaid VNPay orders past the cut-off, EXCEPT those that still have a live payment link: the customer
   * may be at the bank right now. Cancelling then would turn a normal payment into a refund.
   */
  async findExpiredUnpaidIds(
    db: Db,
    cutoff: Date,
    limit: number,
  ): Promise<number[]> {
    const rows = await db("orders")
      .where({
        payment_method: "vnpay",
        payment_status: "unpaid",
        order_status: "pending",
      })
      .where("created_at", "<", cutoff)
      .whereNotExists(
        db("payments")
          .select(db.raw("1"))
          .whereRaw("payments.order_id = orders.id")
          .where("payments.status", "pending")
          .where("payments.expires_at", ">", db.fn.now()),
      )
      .orderBy("id")
      .limit(limit)
      .select("id");
    return rows.map((r: { id: number }) => r.id);
  }
}

import type { Knex } from "knex";
import type { Db } from "../../common/utils/db.js";
import { firstId } from "../../common/utils/db.js";
import { toOffset, type Paged } from "../../common/utils/pagination.js";
import type { PaymentRow, RefundRow } from "./payments.types.js";

export type RefundListStatus = "pending" | "refunded" | "all";

// Fixed strings, never user input. Pending refunds: the one waiting longest comes first.
const REFUND_ORDER: Record<RefundListStatus, string> = {
  pending: "p.paid_at ASC NULLS LAST, p.id ASC",
  refunded: "p.refunded_at DESC NULLS LAST, p.id DESC",
  all: "p.id DESC",
};

export class PaymentsRepository {
  insert(
    db: Db,
    data: Pick<
      PaymentRow,
      "order_id" | "provider" | "txn_ref" | "amount" | "expires_at"
    >,
  ): Promise<number> {
    return firstId(db("payments").insert(data).returning("id"));
  }

  async countByOrder(db: Db, orderId: number): Promise<number> {
    const row = await db("payments")
      .where({ order_id: orderId })
      .count({ total: "*" })
      .first();
    return Number((row as { total?: number })?.total ?? 0);
  }

  async findById(db: Db, id: number): Promise<PaymentRow | undefined> {
    return db("payments").where({ id }).first();
  }

  async findByIdForUpdate(db: Db, id: number): Promise<PaymentRow | undefined> {
    return db("payments").where({ id }).forUpdate().first();
  }

  async findByTxnRef(db: Db, txnRef: string): Promise<PaymentRow | undefined> {
    return db("payments").where({ txn_ref: txnRef }).first();
  }

  /** Serializes concurrent and duplicate IPN deliveries of the same transaction. */
  async findByTxnRefForUpdate(
    db: Db,
    txnRef: string,
  ): Promise<PaymentRow | undefined> {
    return db("payments").where({ txn_ref: txnRef }).forUpdate().first();
  }

  async update(db: Db, id: number, patch: Partial<PaymentRow>): Promise<void> {
    await db("payments").where({ id }).update(patch);
  }

  // ---------------------------------------------------------------- refunds

  /** Flags every successful, not-yet-flagged payment of an order. Returns how many. */
  flagRefundForOrder(db: Db, orderId: number, reason: string): Promise<number> {
    return db("payments")
      .where({ order_id: orderId, status: "success", refund_status: "none" })
      .update({ refund_status: "pending", refund_reason: reason });
  }

  /** Only a PENDING refund can be closed: a repeat matches no row and returns 0. */
  markRefunded(db: Db, id: number, actorId: number): Promise<number> {
    return db("payments")
      .where({ id, refund_status: "pending" })
      .update({
        refund_status: "refunded",
        refunded_at: new Date(),
        refunded_by: actorId,
      });
  }

  markOrderRefunded(db: Db, orderId: number, actorId: number): Promise<number> {
    return db("payments")
      .where({ order_id: orderId, refund_status: "pending" })
      .update({
        refund_status: "refunded",
        refunded_at: new Date(),
        refunded_by: actorId,
      });
  }

  async countPendingRefunds(db: Db, orderId: number): Promise<number> {
    const row = await db("payments")
      .where({ order_id: orderId, refund_status: "pending" })
      .count({ total: "*" })
      .first();
    return Number((row as { total?: number })?.total ?? 0);
  }

  private withOrder(db: Db) {
    return db("payments as p")
      .join("orders as o", "o.id", "p.order_id")
      .select(
        "p.*",
        "o.order_code",
        "o.order_status",
        "o.payment_status as order_payment_status",
      );
  }

  async findRefund(db: Db, id: number): Promise<RefundRow | undefined> {
    return this.withOrder(db).where("p.id", id).first();
  }

  async listRefunds(
    db: Db,
    status: RefundListStatus,
    page: number,
    perPage: number,
  ): Promise<Paged<RefundRow>> {
    const apply = (qb: Knex.QueryBuilder) => {
      if (status === "all") qb.whereNot("p.refund_status", "none");
      else qb.where("p.refund_status", status);
    };
    const [items, countRow] = await Promise.all([
      this.withOrder(db)
        .modify(apply)
        .orderByRaw(REFUND_ORDER[status])
        .limit(perPage)
        .offset(toOffset(page, perPage)),
      db("payments as p").modify(apply).count({ total: "p.id" }).first(),
    ]);
    return {
      items: items as RefundRow[],
      total: Number((countRow as { total?: number })?.total ?? 0),
    };
  }
}

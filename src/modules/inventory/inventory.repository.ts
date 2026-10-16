import type { Knex } from "knex";
import type { Db } from "../../common/utils/db.js";
import { toOffset, type Paged } from "../../common/utils/pagination.js";
import type {
  InventoryEntry,
  InventoryFilter,
  InventoryHistoryRow,
} from "./inventory.types.js";

/** Append-only stock ledger. Always call it in the SAME transaction that changes products.quantity. */
export class InventoryRepository {
  async record(db: Db, e: InventoryEntry): Promise<void> {
    await db("inventory_histories").insert({
      product_id: e.productId,
      delta: e.delta,
      quantity_after: e.quantityAfter,
      reason: e.reason,
      order_id: e.orderId ?? null,
      created_by: e.createdBy ?? null,
      notes: e.notes ?? null,
    });
  }

  async list(db: Db, f: InventoryFilter): Promise<Paged<InventoryHistoryRow>> {
    const apply = (qb: Knex.QueryBuilder) => {
      if (f.productId) qb.where("product_id", f.productId);
      if (f.reason) qb.where("reason", f.reason);
    };
    const [items, countRow] = await Promise.all([
      db("inventory_histories")
        .modify(apply)
        .orderBy("id", "desc")
        .limit(f.perPage)
        .offset(toOffset(f.page, f.perPage)),
      db("inventory_histories").modify(apply).count({ total: "*" }).first(),
    ]);
    return {
      items: items as InventoryHistoryRow[],
      total: Number((countRow as { total?: number })?.total ?? 0),
    };
  }
}

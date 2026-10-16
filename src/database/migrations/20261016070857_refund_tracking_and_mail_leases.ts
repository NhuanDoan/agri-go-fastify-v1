import type { Knex } from "knex";
import { addCheck } from "../helpers.js";

export async function up(knex: Knex): Promise<void> {
  // ---- refunds are tracked PER PAYMENT: the money to return belongs to one VNPay transaction ----
  await knex.schema.alterTable("payments", (t) => {
    t.enu("refund_status", ["none", "pending", "refunded"])
      .notNullable()
      .defaultTo("none");
    t.string("refund_reason", 255);
    t.timestamp("refunded_at", { useTz: true });
    t.integer("refunded_by")
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");
  });

  // Backfill what earlier versions only recorded in order history or order.payment_status.
  // 1) payments of orders that were cancelled after being paid
  await knex.raw(`
    UPDATE payments p
       SET refund_status = CASE WHEN o.payment_status = 'refunded' THEN 'refunded' ELSE 'pending' END,
           refund_reason = 'Order cancelled after payment (backfilled)',
           refunded_at   = CASE WHEN o.payment_status = 'refunded' THEN o.updated_at END
      FROM orders o
     WHERE o.id = p.order_id AND p.status = 'success' AND o.payment_status IN ('refund_pending', 'refunded')
  `);
  // 2) duplicates: when one order has several unflagged successful payments, every one after the first is extra
  await knex.raw(`
    UPDATE payments p
       SET refund_status = 'pending', refund_reason = 'Duplicate payment (backfilled)'
      FROM (
        SELECT id, row_number() OVER (PARTITION BY order_id ORDER BY paid_at NULLS LAST, id) AS rn
          FROM payments WHERE status = 'success' AND refund_status = 'none'
      ) d
     WHERE p.id = d.id AND d.rn > 1
  `);

  await addCheck(
    knex,
    "payments",
    "payments_refund_needs_success",
    "refund_status = 'none' OR status = 'success'",
  );
  // the refund queue only ever reads pending rows: a tiny index that stays small however many payments exist
  await knex.raw(
    "CREATE INDEX payments_refund_queue_idx ON payments (paid_at, id) WHERE refund_status = 'pending'",
  );

  // ---- mail leases: a claim is a timestamp + token, not an open transaction ----
  await knex.schema.alterTable("mail_outbox", (t) => {
    t.timestamp("locked_until", { useTz: true });
    t.uuid("lock_token");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("mail_outbox", (t) => {
    t.dropColumns("locked_until", "lock_token");
  });
  await knex.raw("DROP INDEX IF EXISTS payments_refund_queue_idx");
  await knex.raw(
    "ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_refund_needs_success",
  );
  await knex.schema.alterTable("payments", (t) => {
    t.dropColumns(
      "refund_status",
      "refund_reason",
      "refunded_at",
      "refunded_by",
    );
  });
}

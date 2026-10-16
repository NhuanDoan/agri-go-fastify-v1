import type { Knex } from "knex";
import { addUpdatedAtTrigger, timestamps } from "../helpers.js";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("payments", (t) => {
    t.increments("id");
    t.integer("order_id")
      .notNullable()
      .references("id")
      .inTable("orders")
      .onDelete("RESTRICT");
    t.enu("provider", ["vnpay"]).notNullable();
    t.string("txn_ref", 64).notNullable().unique(); // vnp_TxnRef: uniqueness is what makes IPN handling idempotent
    t.bigInteger("amount").notNullable(); // VND, what we asked for
    t.enu("status", ["pending", "success", "failed"])
      .notNullable()
      .defaultTo("pending");
    t.string("provider_txn_no", 32); // vnp_TransactionNo
    t.string("bank_code", 32);
    t.string("response_code", 8);
    t.timestamp("paid_at", { useTz: true });
    t.jsonb("raw_payload"); // the full signed IPN, kept for disputes and reconciliation
    t.timestamp("expires_at", { useTz: true }).notNullable(); // when the payment link dies
    timestamps(knex, t);
    t.index(["order_id"]);
  });
  await addUpdatedAtTrigger(knex, "payments");

  // serves the expiry job: "unpaid VNPay orders older than X"
  await knex.schema.alterTable("orders", (t) => {
    t.index(
      ["payment_method", "payment_status", "order_status", "created_at"],
      "orders_expiry_idx",
    );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("orders", (t) => {
    t.dropIndex([], "orders_expiry_idx");
  });
  await knex.schema.dropTableIfExists("payments");
}

import type { Knex } from "knex";
import { addCheck, addUpdatedAtTrigger, timestamps } from "../helpers.js";

export async function up(knex: Knex): Promise<void> {
  // ---- carts: exactly one per user, one row per product ----
  await knex.schema.createTable("carts", (t) => {
    t.increments("id");
    t.integer("user_id")
      .notNullable()
      .unique()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    timestamps(knex, t);
  });
  await addUpdatedAtTrigger(knex, "carts");

  await knex.schema.createTable("cart_items", (t) => {
    t.increments("id");
    t.integer("cart_id")
      .notNullable()
      .references("id")
      .inTable("carts")
      .onDelete("CASCADE");
    t.integer("product_id")
      .notNullable()
      .references("id")
      .inTable("products")
      .onDelete("CASCADE");
    t.integer("quantity").notNullable();
    timestamps(knex, t);
    t.unique(["cart_id", "product_id"]);
  });
  await addCheck(
    knex,
    "cart_items",
    "cart_items_quantity_positive",
    "quantity > 0",
  );
  await addUpdatedAtTrigger(knex, "cart_items");

  // ---- orders: money and address are SNAPSHOTS ----
  await knex.schema.createTable("orders", (t) => {
    t.increments("id");
    t.string("order_code", 32).notNullable().unique(); // public reference; ids stay internal
    t.integer("user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("RESTRICT");
    t.bigInteger("subtotal").notNullable();
    t.bigInteger("shipping_fee").notNullable().defaultTo(0);
    t.bigInteger("total_price").notNullable();
    // the full set is created now so Step 8 (VNPay) never has to alter these CHECK constraints
    t.enu("payment_method", ["cod", "vnpay"]).notNullable();
    t.enu("payment_status", ["unpaid", "paid", "refund_pending", "refunded"])
      .notNullable()
      .defaultTo("unpaid");
    t.enu("order_status", [
      "pending",
      "confirmed",
      "shipping",
      "completed",
      "cancelled",
    ])
      .notNullable()
      .defaultTo("pending");
    t.string("receiver_name", 100).notNullable();
    t.string("receiver_phone", 20).notNullable();
    t.text("shipping_address").notNullable();
    t.text("note");
    t.timestamp("paid_at", { useTz: true });
    t.timestamp("cancelled_at", { useTz: true });
    t.string("cancel_reason", 255);
    timestamps(knex, t);
    t.index(["user_id", "created_at"], "orders_user_created_idx");
    t.index(["order_status"], "orders_status_idx");
  });
  await addCheck(
    knex,
    "orders",
    "orders_total_consistent",
    "total_price = subtotal + shipping_fee",
  );
  await addUpdatedAtTrigger(knex, "orders");

  await knex.schema.createTable("order_details", (t) => {
    t.increments("id");
    t.integer("order_id")
      .notNullable()
      .references("id")
      .inTable("orders")
      .onDelete("CASCADE");
    t.integer("product_id")
      .notNullable()
      .references("id")
      .inTable("products")
      .onDelete("RESTRICT");
    t.string("product_name", 191).notNullable(); // snapshot: survives renames and deletes
    t.string("unit", 20).notNullable();
    t.integer("quantity").notNullable();
    t.bigInteger("price").notNullable();
    // derived, so it can never disagree with price * quantity (PostgreSQL 12+)
    t.specificType(
      "subtotal",
      "bigint GENERATED ALWAYS AS (price * quantity) STORED",
    );
    t.timestamp("created_at", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    t.index(["order_id"]);
    t.index(["product_id"]);
  });
  await addCheck(
    knex,
    "order_details",
    "order_details_quantity_positive",
    "quantity > 0",
  );

  await knex.schema.createTable("order_status_histories", (t) => {
    t.increments("id");
    t.integer("order_id")
      .notNullable()
      .references("id")
      .inTable("orders")
      .onDelete("CASCADE");
    t.string("from_status", 20);
    t.string("to_status", 20).notNullable();
    t.string("note", 255);
    t.integer("changed_by")
      .references("id")
      .inTable("users")
      .onDelete("SET NULL"); // null = the system
    t.timestamp("created_at", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    t.index(["order_id"]);
  });

  // the ledger's order_id column has existed since Step 5; now the table it points to exists
  await knex.schema.alterTable("inventory_histories", (t) => {
    t.foreign("order_id")
      .references("id")
      .inTable("orders")
      .onDelete("SET NULL");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("inventory_histories", (t) => {
    t.dropForeign("order_id");
  });
  for (const table of [
    "order_status_histories",
    "order_details",
    "orders",
    "cart_items",
    "carts",
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
}

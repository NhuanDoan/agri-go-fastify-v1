import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("inventory_histories", (t) => {
    t.increments("id");
    t.integer("product_id")
      .notNullable()
      .references("id")
      .inTable("products")
      .onDelete("RESTRICT");
    t.integer("delta").notNullable(); // signed change: +25 received, -3 sold
    t.integer("quantity_after").notNullable(); // balance after this row
    t.enu("reason", [
      "import",
      "adjustment",
      "order_placed",
      "order_cancelled",
    ]).notNullable();
    t.integer("order_id"); // the FK to orders is added in Step 7, when that table exists
    t.integer("created_by")
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");
    t.text("notes");
    t.timestamp("created_at", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    t.index(["product_id", "created_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("inventory_histories");
}

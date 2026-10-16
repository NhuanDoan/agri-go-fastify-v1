import type { Knex } from "knex";
import { addCheck, addUpdatedAtTrigger, timestamps } from "../helpers.js";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("categories", (t) => {
    t.increments("id");
    t.string("name", 100).notNullable().unique();
    t.string("slug", 150).notNullable().unique();
    t.text("description");
    t.string("image_url", 500);
    t.string("image_public_id", 255);
    timestamps(knex, t);
  });
  await addUpdatedAtTrigger(knex, "categories");

  await knex.schema.createTable("products", (t) => {
    t.increments("id");
    t.integer("category_id")
      .notNullable()
      .references("id")
      .inTable("categories")
      .onDelete("RESTRICT");
    t.string("name", 191).notNullable();
    t.string("slug", 191).notNullable().unique();
    t.text("description");
    t.bigInteger("price").notNullable(); // integer VND: money never touches floating point
    t.integer("quantity").notNullable().defaultTo(0);
    t.string("unit", 20).notNullable().defaultTo("kg");
    t.enu("status", ["active", "inactive"]).notNullable().defaultTo("active");
    t.timestamp("deleted_at", { useTz: true }); // soft delete: old orders keep pointing at the product
    timestamps(knex, t);
    t.index(["category_id"]);
    t.index(["status"]);
  });
  await addCheck(knex, "products", "products_price_nonneg", "price >= 0");
  await addCheck(knex, "products", "products_quantity_nonneg", "quantity >= 0"); // last line of defence vs overselling
  await addUpdatedAtTrigger(knex, "products");

  await knex.schema.createTable("product_images", (t) => {
    t.increments("id");
    t.integer("product_id")
      .notNullable()
      .references("id")
      .inTable("products")
      .onDelete("CASCADE");
    t.string("image_url", 500).notNullable();
    t.string("public_id", 255);
    t.boolean("is_primary").notNullable().defaultTo(false);
    t.integer("sort_order").notNullable().defaultTo(0);
    timestamps(knex, t);
    t.index(["product_id"]);
  });
  // at most ONE primary image per product (partial unique index)
  await knex.raw(
    "CREATE UNIQUE INDEX product_images_one_primary_uq ON product_images (product_id) WHERE is_primary",
  );
  await addUpdatedAtTrigger(knex, "product_images");
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("product_images");
  await knex.schema.dropTableIfExists("products");
  await knex.schema.dropTableIfExists("categories");
}

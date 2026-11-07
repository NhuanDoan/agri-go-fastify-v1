import type { Knex } from "knex";
import { addCheck } from "../helpers.js";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("products", (t) => {
    t.integer("discount_percent").notNullable().defaultTo(0);
  });
  await addCheck(
    knex,
    "products",
    "products_discount_percent_range",
    "discount_percent BETWEEN 0 AND 100",
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("products", (t) => {
    t.dropColumn("discount_percent");
  });
}

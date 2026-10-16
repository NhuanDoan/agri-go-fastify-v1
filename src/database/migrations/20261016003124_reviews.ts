import type { Knex } from "knex";
import { addCheck, addUpdatedAtTrigger, timestamps } from "../helpers.js";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("reviews", (t) => {
    t.increments("id");
    t.integer("user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    t.integer("product_id")
      .notNullable()
      .references("id")
      .inTable("products")
      .onDelete("CASCADE");
    t.smallint("rating").notNullable();
    t.text("comment");
    timestamps(knex, t);
    t.unique(["user_id", "product_id"]); // one review per customer per product, enforced by the database
    t.index(["product_id"]);
  });
  await addCheck(
    knex,
    "reviews",
    "reviews_rating_range",
    "rating BETWEEN 1 AND 5",
  );
  await addUpdatedAtTrigger(knex, "reviews");
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("reviews");
}

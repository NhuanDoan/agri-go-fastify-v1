import type { Knex } from "knex";
import { timestamps } from "../helpers.js";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("cloudinary_cleanup", (t) => {
    t.increments("id");
    t.string("public_id", 255).notNullable().unique();
    t.integer("attempts").notNullable().defaultTo(0);
    t.timestamp("available_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp("locked_until", { useTz: true });
    t.uuid("lock_token");
    t.text("last_error");
    timestamps(knex, t);
    t.index(["available_at"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("cloudinary_cleanup");
}

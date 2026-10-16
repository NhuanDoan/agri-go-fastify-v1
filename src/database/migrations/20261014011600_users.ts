import type { Knex } from "knex";
import { addUpdatedAtTrigger, timestamps } from "../helpers.js";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
    BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $$ LANGUAGE plpgsql
  `);

  await knex.schema.createTable("users", (t) => {
    t.increments("id");
    t.string("full_name", 100).notNullable();
    t.string("email", 191).notNullable();
    t.timestamp("email_verified_at", { useTz: true });
    t.string("password_hash", 255).notNullable(); // Laravel's $2y$ bcrypt hashes still verify
    t.string("phone", 20);
    t.string("avatar_url", 500);
    t.string("avatar_public_id", 255); // Cloudinary id, so a replaced image can be deleted
    t.text("address");
    t.enu("role", ["admin", "customer"]).notNullable().defaultTo("customer");
    t.enu("status", ["active", "locked"]).notNullable().defaultTo("active");
    timestamps(knex, t);
  });

  // case-insensitive uniqueness: A@x.com and a@x.com are the same person
  await knex.raw(
    "CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email))",
  );
  await addUpdatedAtTrigger(knex, "users");
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("users");
  await knex.raw("DROP FUNCTION IF EXISTS set_updated_at()");
}

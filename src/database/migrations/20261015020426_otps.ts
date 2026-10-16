import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("user_otps", (t) => {
    t.increments("id");
    t.integer("user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    t.enu("purpose", ["email_verification", "password_reset"]).notNullable();
    t.specificType("code_hash", "char(64)").notNullable(); // HMAC, never the code
    t.smallint("attempts").notNullable().defaultTo(0);
    t.timestamp("expires_at", { useTz: true }).notNullable();
    t.timestamp("consumed_at", { useTz: true });
    t.timestamp("created_at", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    t.index(["user_id", "purpose"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("user_otps");
}

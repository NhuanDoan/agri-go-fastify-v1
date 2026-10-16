import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("refresh_tokens", (t) => {
    t.uuid("id").primary(); // = the JWT's jti
    t.integer("user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    t.uuid("family_id").notNullable().index(); // every token descended from one login shares it
    t.specificType("token_hash", "char(64)").notNullable(); // sha256 hex; never the token itself
    t.timestamp("expires_at", { useTz: true }).notNullable().index();
    t.timestamp("revoked_at", { useTz: true });
    t.uuid("replaced_by");
    t.string("user_agent", 255);
    t.string("ip", 45);
    t.timestamp("created_at", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    t.index(["user_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("refresh_tokens");
}

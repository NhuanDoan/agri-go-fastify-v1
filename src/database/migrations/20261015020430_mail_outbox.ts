import type { Knex } from "knex";
import { addUpdatedAtTrigger, timestamps } from "../helpers.js";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("mail_outbox", (t) => {
    t.increments("id");
    t.string("type", 50).notNullable(); // template key
    t.string("to_email", 191).notNullable();
    t.jsonb("payload").notNullable(); // template data; scrubbed to {} once sent
    t.enu("status", ["pending", "sent", "failed"])
      .notNullable()
      .defaultTo("pending");
    t.smallint("attempts").notNullable().defaultTo(0);
    t.timestamp("next_attempt_at", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    t.text("last_error");
    t.timestamp("sent_at", { useTz: true });
    timestamps(knex, t);
    t.index(["status", "next_attempt_at"]); // the worker's "what is due?" query
  });
  await addUpdatedAtTrigger(knex, "mail_outbox");
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("mail_outbox");
}

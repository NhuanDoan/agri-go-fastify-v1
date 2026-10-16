import type { Knex } from "knex";
import { addCheck, addUpdatedAtTrigger, timestamps } from "../helpers.js";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("chat_rooms", (t) => {
    t.increments("id");
    // the old schema had only admin_id, so a room had no customer. Now: exactly one room per customer.
    t.integer("customer_id")
      .notNullable()
      .unique()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    t.integer("admin_id")
      .references("id")
      .inTable("users")
      .onDelete("SET NULL"); // first admin to reply
    t.timestamp("last_message_at", { useTz: true });
    timestamps(knex, t);
    t.index(["last_message_at"]);
  });
  await addUpdatedAtTrigger(knex, "chat_rooms");

  await knex.schema.createTable("messages", (t) => {
    t.increments("id");
    t.integer("room_id")
      .notNullable()
      .references("id")
      .inTable("chat_rooms")
      .onDelete("CASCADE");
    t.integer("sender_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    t.text("message").notNullable();
    t.timestamp("read_at", { useTz: true });
    t.timestamp("created_at", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    t.index(["room_id", "id"]); // "latest messages of a room"
  });
  await addCheck(
    knex,
    "messages",
    "messages_length",
    "char_length(message) BETWEEN 1 AND 2000",
  );
  // tiny index that only holds UNREAD rows: unread counts stay cheap however long the history grows
  await knex.raw(
    "CREATE INDEX messages_unread_idx ON messages (room_id) WHERE read_at IS NULL",
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("messages");
  await knex.schema.dropTableIfExists("chat_rooms");
}

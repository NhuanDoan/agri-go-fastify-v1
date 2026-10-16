import type { Knex } from "knex";

export function timestamps(knex: Knex, t: Knex.CreateTableBuilder): void {
  t.timestamp("created_at", { useTz: true })
    .notNullable()
    .defaultTo(knex.fn.now());
  t.timestamp("updated_at", { useTz: true })
    .notNullable()
    .defaultTo(knex.fn.now());
}

export function addUpdatedAtTrigger(
  knex: Knex,
  table: string,
): Promise<unknown> {
  return knex.raw(
    `CREATE TRIGGER ${table}_set_updated_at BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  );
}

export function addCheck(
  knex: Knex,
  table: string,
  name: string,
  expression: string,
): Promise<unknown> {
  return knex.raw(
    `ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${expression})`,
  );
}

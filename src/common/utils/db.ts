import type { Knex } from "knex";

/** The pool or an open transaction: repositories accept both. */
export type Db = Knex | Knex.Transaction;

/** First `id` of an `INSERT ... RETURNING id` (PostgreSQL doesn't hand back insert ids by itself). */
export async function firstId(query: PromiseLike<any[]>): Promise<number> {
  const rows = await query;
  return (rows[0] as { id: number }).id;
}

/** Escape LIKE wildcards in user input and wrap it for a contains-search (use with ILIKE). */
export const likeTerm = (q: string): string =>
  `%${q.replace(/[\\%_]/g, "\\$&")}%`;

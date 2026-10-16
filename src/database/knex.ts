import knex, { type Knex } from "knex";
import pg from "pg";
import type { AppConfig } from "../config/env.js";

pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => Number(v));

export function createKnex(config: AppConfig): Knex {
  return knex({
    client: "pg",
    connection: {
      host: config.DB_HOST,
      port: config.DB_PORT,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      database: config.DB_NAME,
      ssl: config.DB_SSL ? { rejectUnauthorized: false } : undefined,
    },
    pool: { min: config.DB_POOL_MIN, max: config.DB_POOL_MAX },
    acquireConnectionTimeout: config.DB_ACQUIRE_TIMEOUT_MS, // fail in 10 s, not 60, when the pool is exhausted
  });
}

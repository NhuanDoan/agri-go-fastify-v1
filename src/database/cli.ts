import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/env.js";
import { createKnex } from "./knex.js";
import {
  migrationConfig,
  migrationDirectory,
  migrationExtension,
} from "./migrator.js";
import { runSeed } from "./seed.js";

const [command = "latest", arg] = process.argv.slice(2);

const template = `import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
}

export async function down(knex: Knex): Promise<void> {
}
`;

async function main(): Promise<void> {
  if (command === "make") {
    if (!arg) throw new Error("Usage: pnpm migrate:make <name>");
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    await mkdir(migrationDirectory, { recursive: true });
    const file = path.join(
      migrationDirectory,
      `${stamp}_${arg}${migrationExtension}`,
    );
    await writeFile(file, template);
    console.log(`Created ${file}`);
    return;
  }

  const config = loadConfig();
  const db = createKnex(config);
  try {
    switch (command) {
      case "latest": {
        const [batch, files] = await db.migrate.latest(migrationConfig);
        console.log(
          files.length
            ? `Batch ${batch}:\n${files.join("\n")}`
            : "Already up to date",
        );
        break;
      }
      case "rollback": {
        const [batch, files] = await db.migrate.rollback(migrationConfig);
        console.log(
          files.length
            ? `Rolled back batch ${batch}:\n${files.join("\n")}`
            : "Nothing to roll back",
        );
        break;
      }
      case "rollback-all": {
        if (config.NODE_ENV === "production") {
          throw new Error("rollback-all is disabled in production");
        }
        const [, files] = await db.migrate.rollback(migrationConfig, true);
        console.log(
          files.length
            ? `Rolled back ${files.length} migration(s):\n${files.join("\n")}`
            : "Nothing to roll back",
        );
        break;
      }
      case "status": {
        const [done, pending] = (await db.migrate.list(migrationConfig)) as [
          { name: string }[],
          { file: string }[],
        ];
        console.log(
          `Applied (${done.length}):\n${done.map((m) => `  ${m.name}`).join("\n")}`,
        );
        console.log(
          `Pending (${pending.length}):\n${pending.map((m) => `  ${m.file}`).join("\n")}`,
        );
        break;
      }
      case "seed":
        await runSeed(db, config);
        break;
      default:
        throw new Error(
          `Unknown command "${command}" (latest | rollback | status | make)`,
        );
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

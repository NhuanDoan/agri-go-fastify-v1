import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisFile = fileURLToPath(import.meta.url);

export const migrationDirectory = path.join(
  path.dirname(thisFile),
  "migrations",
);

export const migrationExtension = path.extname(thisFile);

const migrationSource = {
  async getMigrations() {
    const files = await readdir(migrationDirectory);

    return files.filter((file) => file.endsWith(migrationExtension)).sort();
  },

  getMigrationName(migration: string) {
    return migration.replace(/\.js$/, ".ts");
  },

  async getMigration(migration: string) {
    const migrationPath = path.join(migrationDirectory, migration);

    return import(pathToFileURL(migrationPath).href);
  },
};

export const migrationConfig = {
  migrationSource,
};

import { writeFile } from "node:fs/promises";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";

// usage: pnpm openapi [file]   -> writes the OpenAPI spec (default openapi.json) for frontend teams and API clients
const out = process.argv[2] ?? "openapi.json";
const app = await buildApp({
  ...loadConfig(),
  DOCS_ENABLED: true,
  JOBS_ENABLED: false,
  LOG_LEVEL: "silent",
});
await app.ready();
await writeFile(out, `${JSON.stringify(app.swagger(), null, 2)}\n`);
await app.close();
console.log(`wrote ${out}`);

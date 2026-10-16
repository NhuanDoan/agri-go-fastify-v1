import { execSync } from "node:child_process";
import { testEnv } from "./helpers.js";

export default function setup(): void {
  execSync("pnpm exec tsx src/database/cli.ts latest", {
    env: { ...process.env, ...testEnv() },
    stdio: "inherit",
  });
}

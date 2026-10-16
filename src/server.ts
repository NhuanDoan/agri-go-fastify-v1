import { buildApp } from "./app.js";
import { loadConfig } from "./config/env.js";

const config = loadConfig();
const app = await buildApp(config);

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, "shutting down");

  // hard stop: if draining hangs (a stuck request, a dead database) we must not linger half-alive forever
  const force = setTimeout(() => {
    app.log.error("graceful shutdown timed out; forcing exit");
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_SECONDS * 1000);
  force.unref();

  try {
    app.draining = true; // readiness now answers 503: the load balancer stops sending NEW requests
    if (config.SHUTDOWN_DELAY_SECONDS > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, config.SHUTDOWN_DELAY_SECONDS * 1000),
      );
    }
    await app.close(); // finish in-flight requests, stop the job timers, close the database pool
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "error during shutdown");
    process.exit(1);
  }
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// A promise nobody awaited failed: log it loudly, but one stray rejection should not take the server down.
process.on("unhandledRejection", (reason) =>
  app.log.error({ err: reason }, "unhandled promise rejection"),
);
// An exception nobody caught leaves the process in an unknown state: log and exit, let the orchestrator restart us.
process.on("uncaughtException", (err) => {
  app.log.fatal({ err }, "uncaught exception");
  process.exit(1);
});

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  if (config.DOCS_ENABLED)
    app.log.info(`API docs: http://localhost:${config.PORT}/docs`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

import fp from "fastify-plugin";

/**
 * Tiny in-process scheduler. Safe with several instances (the mail worker uses SKIP LOCKED);
 * or run it on one dedicated instance and set JOBS_ENABLED=false on the others.
 */
export default fp(
  async (app) => {
    if (app.config.NODE_ENV === "test" || !app.config.JOBS_ENABLED) return;
    const timers: NodeJS.Timeout[] = [];

    const every = (name: string, ms: number, run: () => Promise<unknown>) => {
      let running = false; // a slow run must never overlap the next tick
      const timer = setInterval(async () => {
        if (running) return;
        running = true;
        try {
          const result = await run();
          if (typeof result === "number" && result > 0)
            app.log.info({ job: name, count: result }, "job done");
        } catch (err) {
          app.log.error({ err, job: name }, "job failed");
        } finally {
          running = false;
        }
      }, ms);
      timer.unref(); // timers must not keep the process alive on shutdown
      timers.push(timer);
    };

    app.addHook("onReady", async () => {
      every("mail-outbox", 5_000, () => app.mail.processBatch());
      every(
        "housekeeping",
        60 * 60_000,
        async () =>
          (await app.services.auth.purgeExpired()) +
          (await app.mail.purgeOld()),
      );
      every("expire-unpaid-orders", 60_000, () =>
        app.services.orders.cancelExpiredUnpaid(),
      );
    });
    app.addHook("onClose", async () => timers.forEach(clearInterval));
  },
  { name: "jobs", dependencies: ["services", "mail"] },
);

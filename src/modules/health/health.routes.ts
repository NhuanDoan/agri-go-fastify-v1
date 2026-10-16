import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";

const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const tags = ["Health"];
  // orchestrators poll these every few seconds: no rate limit, and no "request completed" line each time
  const probe = {
    config: { rateLimit: false as const },
    logLevel: "warn" as const,
  };

  // LIVENESS: is the process alive? Never touches the database: a DB outage must not get the app restarted.
  app.get(
    "/health",
    {
      ...probe,
      schema: {
        tags,
        summary: "Liveness: the process is up",
        response: { 200: Type.Object({ status: Type.Literal("ok") }) },
      },
    },
    async () => ({ status: "ok" as const }),
  );

  // READINESS: should this instance receive traffic right now?
  app.get(
    "/health/ready",
    {
      ...probe,
      schema: {
        tags,
        summary: "Readiness: database reachable and not shutting down",
        response: {
          200: Type.Object({ status: Type.Literal("ready") }),
          503: Type.Object({
            status: Type.Union([
              Type.Literal("unavailable"),
              Type.Literal("draining"),
            ]),
          }),
        },
      },
    },
    async (_request, reply) => {
      if (app.draining)
        return reply.code(503).send({ status: "draining" as const });
      try {
        await app.knex.raw("select 1").timeout(2000); // a hung database must not hang the probe
        return { status: "ready" as const };
      } catch (err) {
        app.log.error({ err }, "readiness check failed");
        return reply.code(503).send({ status: "unavailable" as const });
      }
    },
  );
};

export default healthRoutes;

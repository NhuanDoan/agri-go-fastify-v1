import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fp from "fastify-plugin";

export default fp(
  async (app) => {
    const { config } = app;

    // JSON API: no HTML to protect, and a strict CSP would break Swagger UI's inline assets.
    await app.register(helmet, { contentSecurityPolicy: false });

    await app.register(cors, {
      origin:
        config.CORS_ORIGINS === "*"
          ? "*"
          : config.CORS_ORIGINS.split(",").map((o) => o.trim()),
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    });

    // Global ceiling per IP. Sensitive routes (login, register) will tighten it with `config: { rateLimit }`.
    await app.register(rateLimit, {
      global: true,
      max: config.RATE_LIMIT_MAX,
      timeWindow: "1 minute",
    });
  },
  { name: "security" },
);

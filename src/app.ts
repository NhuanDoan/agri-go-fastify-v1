import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { registerErrorHandler } from "./common/errors/error-handler.js";
import type { AppConfig } from "./config/env.js";
import authRoutes from "./modules/auth/auth.routes.js";
import cartsRoutes from "./modules/carts/carts.routes.js";
import categoriesRoutes from "./modules/categories/categories.routes.js";
import chatRoutes from "./modules/chat/chat.routes.js";
import healthRoutes from "./modules/health/health.routes.js";
import inventoryRoutes from "./modules/inventory/inventory.routes.js";
import type { MailTransport } from "./modules/mail/mail.types.js";
import ordersRoutes from "./modules/orders/orders.routes.js";
import paymentsRoutes from "./modules/payments/payments.routes.js";
import productsRoutes from "./modules/products/products.routes.js";
import reviewsRoutes from "./modules/reviews/reviews.routes.js";
import usersRoutes from "./modules/users/users.routes.js";
import authPlugin from "./plugins/auth.js";
import databasePlugin from "./plugins/database.js";
import jobsPlugin from "./plugins/jobs.js";
import mailPlugin from "./plugins/mail.js";
import securityPlugin from "./plugins/security.js";
import servicesPlugin from "./plugins/services.js";
import swaggerPlugin from "./plugins/swagger.js";

export interface AppOverrides {
  /** Tests pass a capturing transport; production leaves this empty. */
  mailTransport?: MailTransport;
}

/** Short and boring: a client-supplied id ends up in our logs, so it must not carry anything surprising. */
const SAFE_REQUEST_ID = /^[\w.-]{1,64}$/;

export async function buildApp(
  config: AppConfig,
  overrides: AppOverrides = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: ["req.headers.authorization", "req.headers.cookie"], // never log credentials
      transport:
        config.NODE_ENV === "development"
          ? { target: "pino-pretty" }
          : undefined,
    },
    // keep an upstream (proxy/gateway) id so one request can be traced across systems, but only a sane one
    requestIdHeader: false,
    genReqId: (req) => {
      const upstream = req.headers["x-request-id"];
      return typeof upstream === "string" && SAFE_REQUEST_ID.test(upstream)
        ? upstream
        : randomUUID();
    },
    trustProxy: config.TRUST_PROXY,
    requestTimeout: config.REQUEST_TIMEOUT_MS, // a client dribbling a body for minutes ties up a socket
    keepAliveTimeout: config.KEEP_ALIVE_TIMEOUT_MS,
    ajv: { customOptions: { allErrors: true } }, // report ALL invalid fields at once
  });

  app.decorate("config", config);
  app.decorate("draining", false);
  registerErrorHandler(app); // before plugins, so every encapsulated child inherits it

  // onSend (not onRequest) so error and 404 responses carry the id too. Support asks for "the id in the response".
  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  // ORDER MATTERS: shared plugins -> swagger (must see routes) -> database -> auth -> mail -> services -> jobs -> routes
  await app.register(securityPlugin);
  await app.register(swaggerPlugin);
  await app.register(databasePlugin);
  await app.register(authPlugin);
  await app.register(mailPlugin, { transport: overrides.mailTransport });
  await app.register(servicesPlugin);
  await app.register(jobsPlugin);

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(usersRoutes, { prefix: "/api" });
  await app.register(categoriesRoutes, { prefix: "/api/categories" });
  await app.register(productsRoutes, { prefix: "/api/products" });
  await app.register(inventoryRoutes, { prefix: "/api/inventory-histories" });
  await app.register(cartsRoutes, { prefix: "/api/cart" });
  await app.register(ordersRoutes, { prefix: "/api/orders" });
  await app.register(paymentsRoutes, { prefix: "/api/payments" });
  await app.register(reviewsRoutes, { prefix: "/api" });
  await app.register(chatRoutes, { prefix: "/api/chat" });

  return app;
}

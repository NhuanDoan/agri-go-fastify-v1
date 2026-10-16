import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fp from "fastify-plugin";

/** Must be registered BEFORE the route modules: it collects routes as they are added. */
export default fp(
  async (app) => {
    if (!app.config.DOCS_ENABLED) return;

    await app.register(swagger, {
      openapi: {
        openapi: "3.0.3",
        info: {
          title: "AgriGo API",
          description: "Agricultural marketplace REST API (Fastify + Knex).",
          version: "1.0.0",
        },
        components: {
          securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
          },
        },
        tags: [
          { name: "Health" },
          { name: "Auth", description: "Register, login, token rotation" },
          { name: "Users" },
          { name: "Categories" },
          { name: "Products" },
          { name: "Inventory", description: "Append-only stock ledger" },
          { name: "Cart" },
          {
            name: "Orders",
            description: "Checkout, cancellation, status flow",
          },
          { name: "Payments", description: "VNPay IPN and browser return" },
          { name: "Reviews", description: "Verified-purchase reviews" },
          { name: "Chat", description: "Customer and admin support" },
        ],
      },
    });

    await app.register(swaggerUi, {
      routePrefix: "/docs",
      uiConfig: { docExpansion: "list", persistAuthorization: true },
    });
  },
  { name: "swagger" },
);

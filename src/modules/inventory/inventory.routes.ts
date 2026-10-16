import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
  bearerSecurity,
  paginatedOf,
  securedErrors,
} from "../../common/schemas/common.js";
import { InventoryController } from "./inventory.controller.js";
import {
  InventoryHistorySchema,
  ListInventoryQuery,
} from "./inventory.schema.js";

/** Registered under /api/inventory-histories. Read-only: the ledger is written by stock changes themselves. */
const inventoryRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = new InventoryController(app.services.inventory);

  app.get(
    "/",
    {
      prefixTrailingSlash: "no-slash",
      preHandler: [app.authenticate, app.authorize("admin")],
      schema: {
        tags: ["Inventory"],
        summary: "Stock ledger (admin)",
        security: bearerSecurity,
        querystring: ListInventoryQuery,
        response: {
          200: paginatedOf(InventoryHistorySchema),
          ...securedErrors,
        },
      },
    },
    controller.list,
  );
};

export default inventoryRoutes;

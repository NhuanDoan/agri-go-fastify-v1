import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
  ErrorResponse,
  IdParams,
  bearerSecurity,
  paginatedOf,
  securedErrors,
  successOf,
} from "../../common/schemas/common.js";
import { ProductsController } from "./products.controller.js";
import {
  CreateProductBody,
  ListProductsQuery,
  ProductSchema,
  SetQuantityBody,
  SetStatusBody,
  UpdateProductBody,
} from "./products.schema.js";

/** Registered under /api/products. Reads are public (inactive hidden); writes need an admin. */
const productsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = new ProductsController(app.services.products);
  const tags = ["Products"];
  const security = bearerSecurity;
  const admin = [app.authenticate, app.authorize("admin")];
  const found = {
    200: successOf(ProductSchema),
    404: ErrorResponse,
    ...securedErrors,
  };

  app.get(
    "/",
    {
      prefixTrailingSlash: "no-slash",
      preHandler: [app.optionalAuthenticate],
      schema: {
        tags,
        summary: "List and search products",
        description:
          "Public. Anonymous callers and customers only ever see `active` products.",
        querystring: ListProductsQuery,
        response: { 200: paginatedOf(ProductSchema), ...securedErrors },
      },
    },
    controller.list,
  );

  app.get(
    "/:id",
    {
      preHandler: [app.optionalAuthenticate],
      schema: {
        tags,
        summary: "Get a product",
        params: IdParams,
        response: found,
      },
    },
    controller.get,
  );

  app.post(
    "/",
    {
      prefixTrailingSlash: "no-slash",
      preHandler: admin,
      schema: {
        tags,
        summary:
          "Create a product (admin); initial stock is recorded in the ledger",
        security,
        body: CreateProductBody,
        response: { 201: successOf(ProductSchema), ...securedErrors },
      },
    },
    controller.create,
  );

  app.put(
    "/:id",
    {
      preHandler: admin,
      schema: {
        tags,
        summary: "Update a product (admin). Stock is changed via /:id/quantity",
        security,
        params: IdParams,
        body: UpdateProductBody,
        response: found,
      },
    },
    controller.update,
  );

  app.patch(
    "/:id/status",
    {
      preHandler: admin,
      schema: {
        tags,
        summary: "Activate or deactivate (admin)",
        security,
        params: IdParams,
        body: SetStatusBody,
        response: found,
      },
    },
    controller.setStatus,
  );

  app.patch(
    "/:id/quantity",
    {
      preHandler: admin,
      schema: {
        tags,
        summary:
          "Set stock (admin): row-locked and recorded in the stock ledger",
        security,
        params: IdParams,
        body: SetQuantityBody,
        response: found,
      },
    },
    controller.setQuantity,
  );

  app.delete(
    "/:id",
    {
      preHandler: admin,
      schema: {
        tags,
        summary: "Soft-delete a product (admin)",
        security,
        params: IdParams,
        response: {
          200: successOf(Type.Null()),
          404: ErrorResponse,
          ...securedErrors,
        },
      },
    },
    controller.remove,
  );
};

export default productsRoutes;

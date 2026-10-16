import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
  ErrorResponse,
  bearerSecurity,
  securedErrors,
  successOf,
} from "../../common/schemas/common.js";
import { CartsController } from "./carts.controller.js";
import {
  AddCartItemBody,
  CartSchema,
  ProductIdParams,
  SetCartItemBody,
} from "./carts.schema.js";

/** Registered under /api/cart. Every route needs a signed-in user. */
const cartsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = new CartsController(app.services.carts);
  const preHandler = [app.authenticate];
  const tags = ["Cart"];
  const security = bearerSecurity;
  const response = { 200: successOf(CartSchema), ...securedErrors };

  app.get(
    "/",
    {
      prefixTrailingSlash: "no-slash",
      preHandler,
      schema: { tags, summary: "My cart", security, response },
    },
    controller.get,
  );

  app.post(
    "/items",
    {
      preHandler,
      schema: {
        tags,
        summary: "Add a product (quantities accumulate)",
        security,
        body: AddCartItemBody,
        response: { ...response, 404: ErrorResponse },
      },
    },
    controller.add,
  );

  app.put(
    "/items/:productId",
    {
      preHandler,
      schema: {
        tags,
        summary: "Set the quantity of a cart item",
        security,
        params: ProductIdParams,
        body: SetCartItemBody,
        response: { ...response, 404: ErrorResponse },
      },
    },
    controller.setQuantity,
  );

  app.delete(
    "/items/:productId",
    {
      preHandler,
      schema: {
        tags,
        summary: "Remove a cart item",
        security,
        params: ProductIdParams,
        response,
      },
    },
    controller.remove,
  );

  app.delete(
    "/",
    {
      prefixTrailingSlash: "no-slash",
      preHandler,
      schema: { tags, summary: "Empty the cart", security, response },
    },
    controller.clear,
  );
};

export default cartsRoutes;

import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
  ErrorResponse,
  IdParams,
  bearerSecurity,
  commonErrors,
  paginatedOf,
  securedErrors,
  successOf,
} from "../../common/schemas/common.js";
import { CategoriesController } from "./categories.controller.js";
import {
  CategorySchema,
  CreateCategoryBody,
  ListCategoriesQuery,
  UpdateCategoryBody,
} from "./categories.schema.js";

/** Registered under /api/categories. Reads are public, writes need an admin. */
const categoriesRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = new CategoriesController(app.services.categories);
  const tags = ["Categories"];
  const security = bearerSecurity;
  const admin = [app.authenticate, app.authorize("admin")];

  app.get(
    "/",
    {
      prefixTrailingSlash: "no-slash",
      schema: {
        tags,
        summary: "List categories",
        querystring: ListCategoriesQuery,
        response: { 200: paginatedOf(CategorySchema), ...commonErrors },
      },
    },
    controller.list,
  );

  app.get(
    "/:id",
    {
      schema: {
        tags,
        summary: "Get a category",
        params: IdParams,
        response: {
          200: successOf(CategorySchema),
          404: ErrorResponse,
          ...commonErrors,
        },
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
        summary: "Create a category (admin)",
        security,
        body: CreateCategoryBody,
        response: {
          201: successOf(CategorySchema),
          409: ErrorResponse,
          ...securedErrors,
        },
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
        summary: "Update a category (admin)",
        security,
        params: IdParams,
        body: UpdateCategoryBody,
        response: {
          200: successOf(CategorySchema),
          404: ErrorResponse,
          409: ErrorResponse,
          ...securedErrors,
        },
      },
    },
    controller.update,
  );

  app.delete(
    "/:id",
    {
      preHandler: admin,
      schema: {
        tags,
        summary: "Delete a category (admin; refused while it has products)",
        security,
        params: IdParams,
        response: {
          200: successOf(Type.Null()),
          404: ErrorResponse,
          409: ErrorResponse,
          ...securedErrors,
        },
      },
    },
    controller.remove,
  );
};

export default categoriesRoutes;

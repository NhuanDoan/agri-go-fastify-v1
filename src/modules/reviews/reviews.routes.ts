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
import { ReviewsController } from "./reviews.controller.js";
import {
  CreateReviewBody,
  ListReviewsQuery,
  ReviewSchema,
  ReviewSummarySchema,
  UpdateReviewBody,
} from "./reviews.schema.js";

/** Registered under /api: the paths are /products/:id/reviews[/summary] and /reviews/:id. */
const reviewsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = new ReviewsController(app.services.reviews);
  const tags = ["Reviews"];
  const security = bearerSecurity;
  const auth = [app.authenticate];
  const optional = [app.optionalAuthenticate]; // admins may see reviews of inactive products

  app.get(
    "/products/:id/reviews",
    {
      preHandler: optional,
      schema: {
        tags,
        summary: "Reviews of a product, newest first",
        params: IdParams,
        querystring: ListReviewsQuery,
        response: {
          200: paginatedOf(ReviewSchema),
          404: ErrorResponse,
          ...securedErrors,
        },
      },
    },
    controller.list,
  );

  app.get(
    "/products/:id/reviews/summary",
    {
      preHandler: optional,
      schema: {
        tags,
        summary: "Average rating and the 1-5 star distribution",
        params: IdParams,
        response: {
          200: successOf(ReviewSummarySchema),
          404: ErrorResponse,
          ...securedErrors,
        },
      },
    },
    controller.summary,
  );

  app.post(
    "/products/:id/reviews",
    {
      preHandler: auth,
      schema: {
        tags,
        summary: "Review a product you received (one review per product)",
        description: "Needs a COMPLETED order that contains this product.",
        security,
        params: IdParams,
        body: CreateReviewBody,
        response: {
          201: successOf(ReviewSchema),
          404: ErrorResponse,
          409: ErrorResponse,
          ...securedErrors,
        },
      },
    },
    controller.create,
  );

  app.put(
    "/reviews/:id",
    {
      preHandler: auth,
      schema: {
        tags,
        summary: "Edit my review",
        security,
        params: IdParams,
        body: UpdateReviewBody,
        response: {
          200: successOf(ReviewSchema),
          404: ErrorResponse,
          ...securedErrors,
        },
      },
    },
    controller.update,
  );

  app.delete(
    "/reviews/:id",
    {
      preHandler: auth,
      schema: {
        tags,
        summary: "Delete my review (admins: any review)",
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

export default reviewsRoutes;

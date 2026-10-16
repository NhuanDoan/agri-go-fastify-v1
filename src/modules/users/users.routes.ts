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
import { UsersController } from "./users.controller.js";
import {
  CreateUserBody,
  ListUsersQuery,
  UpdateProfileBody,
  UpdateUserBody,
  UserSchema,
} from "./users.schema.js";

/** Registered under /api: `/me` for the signed-in user, `/users` for admins. */
const usersRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = new UsersController(app.services.users);
  const tags = ["Users"];
  const security = bearerSecurity;
  const admin = [app.authenticate, app.authorize("admin")];

  // ----- own profile -----
  app.get(
    "/me",
    {
      preHandler: [app.authenticate],
      schema: {
        tags,
        summary: "The signed-in user",
        security,
        response: { 200: successOf(UserSchema), ...securedErrors },
      },
    },
    controller.me,
  );

  app.put(
    "/me",
    {
      preHandler: [app.authenticate],
      schema: {
        tags,
        summary: "Update my profile (name, phone, address, avatar)",
        security,
        body: UpdateProfileBody,
        response: { 200: successOf(UserSchema), ...securedErrors },
      },
    },
    controller.updateMe,
  );

  // ----- admin CRUD -----
  app.get(
    "/users",
    {
      preHandler: admin,
      schema: {
        tags,
        summary: "List users (admin)",
        security,
        querystring: ListUsersQuery,
        response: { 200: paginatedOf(UserSchema), ...securedErrors },
      },
    },
    controller.list,
  );

  app.get(
    "/users/:id",
    {
      preHandler: admin,
      schema: {
        tags,
        summary: "Get a user (admin)",
        security,
        params: IdParams,
        response: {
          200: successOf(UserSchema),
          404: ErrorResponse,
          ...securedErrors,
        },
      },
    },
    controller.get,
  );

  app.post(
    "/users",
    {
      preHandler: admin,
      schema: {
        tags,
        summary: "Create a user (admin)",
        security,
        body: CreateUserBody,
        response: {
          201: successOf(UserSchema),
          409: ErrorResponse,
          ...securedErrors,
        },
      },
    },
    controller.create,
  );

  app.put(
    "/users/:id",
    {
      preHandler: admin,
      schema: {
        tags,
        summary: "Update a user (admin)",
        security,
        params: IdParams,
        body: UpdateUserBody,
        response: {
          200: successOf(UserSchema),
          404: ErrorResponse,
          409: ErrorResponse,
          ...securedErrors,
        },
      },
    },
    controller.update,
  );

  app.delete(
    "/users/:id",
    {
      preHandler: admin,
      schema: {
        tags,
        summary: "Delete a user (admin)",
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

export default usersRoutes;

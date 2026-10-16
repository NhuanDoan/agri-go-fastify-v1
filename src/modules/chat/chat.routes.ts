import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
  ErrorResponse,
  IdParams,
  bearerSecurity,
  paginatedOf,
  securedErrors,
  successOf,
} from "../../common/schemas/common.js";
import { ChatController } from "./chat.controller.js";
import {
  ChatListQuery,
  MarkedSchema,
  MessageSchema,
  RoomSchema,
  SendMessageBody,
} from "./chat.schema.js";

/**
 * Registered under /api/chat. Plain REST: clients poll the messages endpoint.
 * A realtime layer (WebSocket/SSE) can later sit on top of ChatService without changing it.
 */
const chatRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = new ChatController(app.services.chat);
  const tags = ["Chat"];
  const security = bearerSecurity;
  const auth = [app.authenticate];

  app.post(
    "/rooms/me",
    {
      preHandler: auth,
      schema: {
        tags,
        summary: "My support room (created on first use). Customers only.",
        security,
        response: { 200: successOf(RoomSchema), ...securedErrors },
      },
    },
    controller.myRoom,
  );

  app.get(
    "/rooms",
    {
      preHandler: [app.authenticate, app.authorize("admin")],
      schema: {
        tags,
        summary:
          "The support inbox (admin): latest activity first, with unread counts",
        security,
        querystring: ChatListQuery,
        response: { 200: paginatedOf(RoomSchema), ...securedErrors },
      },
    },
    controller.listRooms,
  );

  app.get(
    "/rooms/:id/messages",
    {
      preHandler: auth,
      schema: {
        tags,
        summary:
          "Messages of a room, newest first. Does not mark anything as read.",
        security,
        params: IdParams,
        querystring: ChatListQuery,
        response: {
          200: paginatedOf(MessageSchema),
          404: ErrorResponse,
          ...securedErrors,
        },
      },
    },
    controller.listMessages,
  );

  app.post(
    "/rooms/:id/messages",
    {
      preHandler: auth,
      schema: {
        tags,
        summary: "Send a message",
        security,
        params: IdParams,
        body: SendMessageBody,
        response: {
          201: successOf(MessageSchema),
          404: ErrorResponse,
          ...securedErrors,
        },
      },
    },
    controller.send,
  );

  app.post(
    "/rooms/:id/read",
    {
      preHandler: auth,
      schema: {
        tags,
        summary:
          "Mark the OTHER side's messages as read (call when the chat window is open). Send no body.",
        security,
        params: IdParams,
        response: {
          200: successOf(MarkedSchema),
          404: ErrorResponse,
          ...securedErrors,
        },
      },
    },
    controller.markRead,
  );
};

export default chatRoutes;

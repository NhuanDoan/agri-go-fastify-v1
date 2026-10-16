import type { FastifyReply, FastifyRequest } from "fastify";
import type { IdParams } from "../../common/schemas/common.js";
import { buildMeta } from "../../common/utils/pagination.js";
import { ok, paginated } from "../../common/utils/response.js";
import { currentUser } from "../../plugins/auth.js";
import type {
  ChatListQuery,
  MessageDto,
  RoomDto,
  SendMessageBody,
} from "./chat.schema.js";
import type { ChatService } from "./chat.service.js";
import type { ChatRoomRow, MessageRow } from "./chat.types.js";

const toRoomDto = (r: ChatRoomRow): RoomDto => ({
  id: r.id,
  customer: { id: r.customer_id, fullName: r.customer_name },
  adminId: r.admin_id,
  lastMessageAt: r.last_message_at?.toISOString() ?? null,
  unreadCount: r.unread_count,
  createdAt: r.created_at.toISOString(),
});

const toMessageDto = (m: MessageRow): MessageDto => ({
  id: m.id,
  roomId: m.room_id,
  senderId: m.sender_id,
  message: m.message,
  readAt: m.read_at?.toISOString() ?? null,
  createdAt: m.created_at.toISOString(),
});

export class ChatController {
  constructor(private readonly service: ChatService) {}

  myRoom = async (request: FastifyRequest) =>
    ok(toRoomDto(await this.service.myRoom(currentUser(request))));

  listRooms = async (
    request: FastifyRequest<{ Querystring: ChatListQuery }>,
  ) => {
    const { page, perPage } = request.query;
    const { items, total } = await this.service.listRooms(page, perPage);
    return paginated(items.map(toRoomDto), buildMeta(page, perPage, total));
  };

  listMessages = async (
    request: FastifyRequest<{ Params: IdParams; Querystring: ChatListQuery }>,
  ) => {
    const { page, perPage } = request.query;
    const { items, total } = await this.service.listMessages(
      currentUser(request),
      request.params.id,
      page,
      perPage,
    );
    return paginated(items.map(toMessageDto), buildMeta(page, perPage, total));
  };

  send = async (
    request: FastifyRequest<{ Params: IdParams; Body: SendMessageBody }>,
    reply: FastifyReply,
  ) => {
    const message = await this.service.send(
      currentUser(request),
      request.params.id,
      request.body.message,
    );
    reply.code(201);
    return ok(toMessageDto(message), "Message sent");
  };

  markRead = async (request: FastifyRequest<{ Params: IdParams }>) =>
    ok({
      marked: await this.service.markRead(
        currentUser(request),
        request.params.id,
      ),
    });
}

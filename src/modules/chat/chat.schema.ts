import { Type, type Static } from "@sinclair/typebox";
import { Nullable, PaginationQuery } from "../../common/schemas/common.js";

export const RoomSchema = Type.Object({
  id: Type.Integer(),
  customer: Type.Object({ id: Type.Integer(), fullName: Type.String() }),
  adminId: Nullable(Type.Integer()),
  lastMessageAt: Nullable(Type.String()),
  unreadCount: Type.Integer(),
  createdAt: Type.String(),
});
export type RoomDto = Static<typeof RoomSchema>;

export const MessageSchema = Type.Object({
  id: Type.Integer(),
  roomId: Type.Integer(),
  senderId: Type.Integer(),
  message: Type.String(),
  readAt: Nullable(Type.String()),
  createdAt: Type.String(),
});
export type MessageDto = Static<typeof MessageSchema>;

export const SendMessageBody = Type.Object(
  { message: Type.String({ minLength: 1, maxLength: 2000 }) },
  { additionalProperties: false },
);
export type SendMessageBody = Static<typeof SendMessageBody>;

export const ChatListQuery = PaginationQuery;
export type ChatListQuery = Static<typeof ChatListQuery>;

export const MarkedSchema = Type.Object({ marked: Type.Integer() });

import type { Knex } from "knex";
import {
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from "../../common/errors/app-error.js";
import type { AuthUser } from "../../common/security/token.service.js";
import type { Paged } from "../../common/utils/pagination.js";
import type { ChatRepository } from "./chat.repository.js";
import type { ChatRoomRow, MessageRow } from "./chat.types.js";

export class ChatService {
  constructor(
    private readonly knex: Knex,
    private readonly repo: ChatRepository,
  ) {}

  /** A customer's own support room, created on first use. Staff use listRooms instead. */
  myRoom(actor: AuthUser): Promise<ChatRoomRow> {
    if (actor.role !== "customer")
      throw new ForbiddenError("Only customers have a support room");
    return this.repo.getOrCreateRoom(this.knex, actor.id);
  }

  listRooms(page: number, perPage: number): Promise<Paged<ChatRoomRow>> {
    return this.repo.listRooms(this.knex, page, perPage); // the route is admin-only
  }

  async listMessages(
    actor: AuthUser,
    roomId: number,
    page: number,
    perPage: number,
  ): Promise<Paged<MessageRow>> {
    await this.authorize(actor, roomId);
    return this.repo.listMessages(this.knex, roomId, page, perPage); // reading never changes read state
  }

  async markRead(actor: AuthUser, roomId: number): Promise<number> {
    const room = await this.authorize(actor, roomId);
    return this.repo.markRead(
      this.knex,
      roomId,
      room.customer_id,
      actor.role === "admin",
    );
  }

  async send(
    actor: AuthUser,
    roomId: number,
    text: string,
  ): Promise<MessageRow> {
    await this.authorize(actor, roomId);
    const message = text.trim();
    if (!message) throw new UnprocessableError("Message cannot be empty"); // "   " passes the schema, not this
    return this.knex.transaction(async (trx) => {
      const saved = await this.repo.insertMessage(trx, {
        room_id: roomId,
        sender_id: actor.id,
        message,
      });
      await this.repo.touchRoom(
        trx,
        roomId,
        actor.role === "admin" ? actor.id : null,
      );
      return saved;
    });
  }

  /** Customers reach only their own room; 404 (not 403) hides that other rooms exist. */
  private async authorize(
    actor: AuthUser,
    roomId: number,
  ): Promise<ChatRoomRow> {
    const room = await this.repo.findRoom(
      this.knex,
      roomId,
      actor.role === "admin",
    );
    if (!room || (actor.role !== "admin" && room.customer_id !== actor.id))
      throw new NotFoundError("Chat room not found");
    return room;
  }
}

import type { Db } from "../../common/utils/db.js";
import { toOffset, type Paged } from "../../common/utils/pagination.js";
import type { ChatRoomRow, MessageRow } from "./chat.types.js";

export class ChatRepository {
  /**
   * Rooms with the customer's name and an unread count seen from the viewer's side:
   * an admin has "unread" what the CUSTOMER wrote, a customer what the STAFF wrote.
   * The interpolated fragment is one of two constants, never user input.
   */
  private rooms(db: Db, forAdmin: boolean) {
    const otherSide = forAdmin
      ? "m.sender_id = r.customer_id"
      : "m.sender_id <> r.customer_id";
    return db("chat_rooms as r")
      .join("users as c", "c.id", "r.customer_id")
      .select(
        "r.*",
        "c.full_name as customer_name",
        db.raw(
          `(select count(*) from messages m where m.room_id = r.id and m.read_at is null and ${otherSide}) as unread_count`,
        ),
      );
  }

  /** Race-safe: concurrent first requests of one customer end up sharing a single room (UNIQUE customer_id). */
  async getOrCreateRoom(db: Db, customerId: number): Promise<ChatRoomRow> {
    await db("chat_rooms")
      .insert({ customer_id: customerId })
      .onConflict("customer_id")
      .ignore();
    return this.rooms(db, false).where("r.customer_id", customerId).first();
  }

  async findRoom(
    db: Db,
    id: number,
    forAdmin: boolean,
  ): Promise<ChatRoomRow | undefined> {
    return this.rooms(db, forAdmin).where("r.id", id).first();
  }

  async listRooms(
    db: Db,
    page: number,
    perPage: number,
  ): Promise<Paged<ChatRoomRow>> {
    const [items, countRow] = await Promise.all([
      this.rooms(db, true)
        .orderByRaw("r.last_message_at DESC NULLS LAST, r.id DESC") // the inbox: latest activity first
        .limit(perPage)
        .offset(toOffset(page, perPage)),
      db("chat_rooms").count({ total: "*" }).first(),
    ]);
    return {
      items: items as ChatRoomRow[],
      total: Number((countRow as { total?: number })?.total ?? 0),
    };
  }

  async listMessages(
    db: Db,
    roomId: number,
    page: number,
    perPage: number,
  ): Promise<Paged<MessageRow>> {
    const [items, countRow] = await Promise.all([
      db("messages")
        .where({ room_id: roomId })
        .orderBy("id", "desc")
        .limit(perPage)
        .offset(toOffset(page, perPage)),
      db("messages").where({ room_id: roomId }).count({ total: "*" }).first(),
    ]);
    return {
      items: items as MessageRow[],
      total: Number((countRow as { total?: number })?.total ?? 0),
    };
  }

  async insertMessage(
    db: Db,
    data: { room_id: number; sender_id: number; message: string },
  ): Promise<MessageRow> {
    const [row] = await db("messages").insert(data).returning("*");
    return row as MessageRow;
  }

  /** Bumps last_message_at; the first admin to answer claims the room (COALESCE keeps an existing admin). */
  async touchRoom(
    db: Db,
    roomId: number,
    adminId: number | null,
  ): Promise<void> {
    await db("chat_rooms")
      .where({ id: roomId })
      .update({
        last_message_at: new Date(),
        ...(adminId
          ? { admin_id: db.raw("COALESCE(admin_id, ?)", [adminId]) }
          : {}),
      });
  }

  /** Marks the OTHER SIDE's unread messages as read. Returns how many changed. */
  async markRead(
    db: Db,
    roomId: number,
    customerId: number,
    readerIsAdmin: boolean,
  ): Promise<number> {
    const q = db("messages").where({ room_id: roomId }).whereNull("read_at");
    if (readerIsAdmin) q.where("sender_id", customerId);
    else q.whereNot("sender_id", customerId);
    return q.update({ read_at: new Date() });
  }
}

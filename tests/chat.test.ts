import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { caller, createUser, resetDb, testConfig } from "./helpers.js";

let app: FastifyInstance;
const call = caller(() => app);
type User = Awaited<ReturnType<typeof createUser>>;
let admin: User;
let admin2: User;
let customer: User;
let other: User;
let roomId: number;

beforeAll(async () => {
  app = await buildApp(testConfig());
});
afterAll(() => app.close());

beforeEach(async () => {
  await resetDb(app.knex);
  admin = await createUser(app, { role: "admin" });
  admin2 = await createUser(app, {
    role: "admin",
    email: "admin2@example.com",
  });
  customer = await createUser(app);
  other = await createUser(app, { email: "other@example.com" });
  roomId = (
    await call("POST", "/api/chat/rooms/me", undefined, customer.token)
  ).json().data.id;
});

const send = (id: number, message: string, token = customer.token) =>
  call("POST", `/api/chat/rooms/${id}/messages`, { message }, token);
const read = (id: number, token: string) =>
  call("POST", `/api/chat/rooms/${id}/read`, undefined, token);
const messages = (id: number, token = customer.token, query = "") =>
  call("GET", `/api/chat/rooms/${id}/messages${query}`, undefined, token);
const inbox = async (query = "") =>
  (await call("GET", `/api/chat/rooms${query}`, undefined, admin.token)).json();
const mine = async (token = customer.token) =>
  (await call("POST", "/api/chat/rooms/me", undefined, token)).json().data;
const roomRow = () => app.knex("chat_rooms").where({ id: roomId }).first();

describe("my room", () => {
  it("requires a login and is for customers only", async () => {
    expect((await call("POST", "/api/chat/rooms/me")).statusCode).toBe(401);
    expect(
      (await call("POST", "/api/chat/rooms/me", undefined, admin.token))
        .statusCode,
    ).toBe(403);
  });

  it("creates the room on first use, and returns the same one afterwards", async () => {
    const room = await mine();
    expect(room).toMatchObject({
      id: roomId,
      customer: { id: customer.id, fullName: "Test User" },
      adminId: null,
      lastMessageAt: null,
      unreadCount: 0,
    });
    expect((await mine()).id).toBe(roomId);
  });

  it("creates exactly one room when the first requests arrive together", async () => {
    const fresh = await createUser(app, { email: "fresh@example.com" });
    const results = await Promise.all(
      [1, 2, 3, 4].map(() =>
        call("POST", "/api/chat/rooms/me", undefined, fresh.token),
      ),
    );
    expect(new Set(results.map((r) => r.json().data.id)).size).toBe(1);
    expect(
      await app.knex("chat_rooms").where({ customer_id: fresh.id }),
    ).toHaveLength(1);
  });
});

describe("sending", () => {
  it("stores a trimmed message and updates the room", async () => {
    const res = await send(roomId, "  Hello, is the mango fresh?  ");
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({
      roomId,
      senderId: customer.id,
      message: "Hello, is the mango fresh?",
      readAt: null,
    });
    expect((await roomRow()).last_message_at).not.toBeNull();
  });

  it("rejects empty, blank and oversized messages", async () => {
    expect((await send(roomId, "")).statusCode).toBe(422);
    expect((await send(roomId, "   ")).statusCode).toBe(422);
    expect((await send(roomId, "x".repeat(2001))).statusCode).toBe(422);
    expect((await send(roomId, "x".repeat(2000))).statusCode).toBe(201);
    expect(await app.knex("messages")).toHaveLength(1);
  });

  it("keeps other customers out with a 404", async () => {
    expect((await send(roomId, "intruder", other.token)).statusCode).toBe(404);
    expect((await messages(roomId, other.token)).statusCode).toBe(404);
    expect((await read(roomId, other.token)).statusCode).toBe(404);
    expect(await app.knex("messages")).toHaveLength(0);
  });

  it("requires a login and a valid room id", async () => {
    expect(
      (
        await call("POST", `/api/chat/rooms/${roomId}/messages`, {
          message: "hi",
        })
      ).statusCode,
    ).toBe(401);
    expect((await send(99999, "hi")).statusCode).toBe(404);
    expect((await send(0 as number, "hi")).statusCode).toBe(422);
  });

  it("lets any admin answer, and the FIRST one claims the room", async () => {
    await send(roomId, "help");
    expect((await send(roomId, "On it", admin.token)).statusCode).toBe(201);
    expect((await roomRow()).admin_id).toBe(admin.id);

    expect((await send(roomId, "Me too", admin2.token)).statusCode).toBe(201);
    expect((await roomRow()).admin_id).toBe(admin.id); // not reassigned
  });

  it("does not let a customer claim the admin slot", async () => {
    await send(roomId, "hello");
    expect((await roomRow()).admin_id).toBeNull();
  });
});

describe("listing messages", () => {
  it("returns the newest first with pagination, to both participants", async () => {
    for (const text of ["one", "two", "three"]) await send(roomId, text);
    const res = await messages(roomId, customer.token, "?perPage=2");
    expect(res.json().meta).toEqual({
      page: 1,
      perPage: 2,
      total: 3,
      totalPages: 2,
    });
    expect(res.json().data.map((m: { message: string }) => m.message)).toEqual([
      "three",
      "two",
    ]);
    expect(
      (await messages(roomId, admin.token, "?perPage=2&page=2"))
        .json()
        .data.map((m: { message: string }) => m.message),
    ).toEqual(["one"]);
  });

  it("is read-only: fetching never marks anything as read", async () => {
    await send(roomId, "hello");
    await messages(roomId, admin.token);
    expect(
      (await messages(roomId, admin.token)).json().data[0].readAt,
    ).toBeNull();
    expect((await inbox()).data[0].unreadCount).toBe(1);
  });

  it("requires a login", async () => {
    expect(
      (await call("GET", `/api/chat/rooms/${roomId}/messages`)).statusCode,
    ).toBe(401);
  });
});

describe("unread counts and read receipts", () => {
  it("counts what the OTHER side wrote, from each viewer's point of view", async () => {
    await send(roomId, "q1");
    await send(roomId, "q2");
    await send(roomId, "answer", admin.token);

    expect((await inbox()).data[0].unreadCount).toBe(2); // admin: the customer's two messages
    expect((await mine()).unreadCount).toBe(1); // customer: the admin's one message
  });

  it("marks only the other side's messages when someone reads", async () => {
    await send(roomId, "q1");
    await send(roomId, "q2");
    await send(roomId, "answer", admin.token);

    const res = await read(roomId, admin.token);
    expect(res.json().data).toEqual({ marked: 2 });
    expect((await inbox()).data[0].unreadCount).toBe(0);
    expect((await mine()).unreadCount).toBe(1); // the admin's own message is still unread by the customer

    const list = (await messages(roomId, customer.token)).json().data as {
      senderId: number;
      readAt: string | null;
    }[];
    expect(
      list
        .filter((m) => m.senderId === customer.id)
        .every((m) => m.readAt !== null),
    ).toBe(true);
    expect(list.find((m) => m.senderId === admin.id)?.readAt).toBeNull();
  });

  it("is idempotent", async () => {
    await send(roomId, "q1");
    expect((await read(roomId, admin.token)).json().data.marked).toBe(1);
    expect((await read(roomId, admin.token)).json().data.marked).toBe(0);
  });

  it("lets the customer acknowledge the staff's replies", async () => {
    await send(roomId, "answer", admin.token);
    expect((await read(roomId, customer.token)).json().data.marked).toBe(1);
    expect((await mine()).unreadCount).toBe(0);
  });

  it("treats all admins as one side: another admin reading does not mark an admin's own reply", async () => {
    await send(roomId, "q1");
    await send(roomId, "answer", admin.token);
    expect((await read(roomId, admin2.token)).json().data.marked).toBe(1); // the customer's message only
    expect((await mine()).unreadCount).toBe(1);
  });
});

describe("the admin inbox", () => {
  it("is admin only", async () => {
    expect((await call("GET", "/api/chat/rooms")).statusCode).toBe(401);
    expect(
      (await call("GET", "/api/chat/rooms", undefined, customer.token))
        .statusCode,
    ).toBe(403);
  });

  it("puts the latest activity first and silent rooms last", async () => {
    const otherRoom = (
      await call("POST", "/api/chat/rooms/me", undefined, other.token)
    ).json().data.id;
    const quiet = await createUser(app, { email: "quiet@example.com" });
    const quietRoom = (
      await call("POST", "/api/chat/rooms/me", undefined, quiet.token)
    ).json().data.id;

    await send(roomId, "first");
    await new Promise((r) => setTimeout(r, 15));
    await send(otherRoom, "second", other.token);

    const ids = (await inbox()).data.map((r: { id: number }) => r.id);
    expect(ids).toEqual([otherRoom, roomId, quietRoom]);
  });

  it("shows the customer's name and paginates", async () => {
    const page = await inbox("?perPage=1");
    expect(page.meta).toMatchObject({ perPage: 1, total: 1, totalPages: 1 });
    expect(page.data[0].customer).toEqual({
      id: customer.id,
      fullName: "Test User",
    });
    expect((await inbox("?perPage=500")).success).toBe(false); // out of range
  });
});

describe("data integrity", () => {
  it("lets the database refuse an empty message", async () => {
    await expect(
      app
        .knex("messages")
        .insert({ room_id: roomId, sender_id: customer.id, message: "" }),
    ).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("removes the room and its messages together with the customer", async () => {
    const lonely = await createUser(app, { email: "lonely@example.com" });
    const lonelyRoom = (
      await call("POST", "/api/chat/rooms/me", undefined, lonely.token)
    ).json().data.id;
    await send(lonelyRoom, "bye", lonely.token);

    expect(
      (await call("DELETE", `/api/users/${lonely.id}`, undefined, admin.token))
        .statusCode,
    ).toBe(200);
    expect(await app.knex("chat_rooms").where({ id: lonelyRoom })).toHaveLength(
      0,
    );
    expect(
      await app.knex("messages").where({ room_id: lonelyRoom }),
    ).toHaveLength(0);
  });

  it("keeps the conversation when an admin account is removed (the room just loses its admin)", async () => {
    await send(roomId, "help");
    await send(roomId, "On it", admin2.token);
    await call("DELETE", `/api/users/${admin2.id}`, undefined, admin.token);
    expect((await roomRow()).admin_id).toBeNull();
    expect(await app.knex("messages").where({ room_id: roomId })).toHaveLength(
      1,
    ); // the customer's message stays
  });
});

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { caller, createUser, resetDb, testConfig } from "./helpers.js";

let app: FastifyInstance;
const call = caller(() => app);
let admin: Awaited<ReturnType<typeof createUser>>;
let customer: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  app = await buildApp(testConfig());
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb(app.knex);
  admin = await createUser(app, { role: "admin" });
  customer = await createUser(app);
});

describe("own profile", () => {
  it('updates name, phone and address; a "role" field is ignored', async () => {
    const res = await call(
      "PUT",
      "/api/me",
      {
        fullName: "New Name",
        phone: "0901234567",
        address: "1 Le Loi, HCMC",
        role: "admin",
      },
      customer.token,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      fullName: "New Name",
      phone: "0901234567",
      address: "1 Le Loi, HCMC",
      role: "customer",
    });
    const row = await app.knex("users").where({ id: customer.id }).first();
    expect(row.role).toBe("customer");
  });

  it("can clear the phone with null", async () => {
    await call("PUT", "/api/me", { phone: "0901234567" }, customer.token);
    const res = await call("PUT", "/api/me", { phone: null }, customer.token);
    expect(res.json().data.phone).toBeNull();
  });

  it("rejects an invalid phone number", async () => {
    const res = await call("PUT", "/api/me", { phone: "abc" }, customer.token);
    expect(res.statusCode).toBe(422);
  });

  it("requires a login", async () => {
    expect((await call("PUT", "/api/me", { fullName: "x" })).statusCode).toBe(
      401,
    );
  });
});

describe("admin guard", () => {
  it("anonymous: 401, customer: 403, admin: 200", async () => {
    expect((await call("GET", "/api/users")).statusCode).toBe(401);
    expect(
      (await call("GET", "/api/users", undefined, customer.token)).statusCode,
    ).toBe(403);
    expect(
      (await call("GET", "/api/users", undefined, admin.token)).statusCode,
    ).toBe(200);
  });

  it("guards every write route too", async () => {
    const body = {
      fullName: "X",
      email: "x@example.com",
      password: "Secret123!",
    };
    expect(
      (await call("POST", "/api/users", body, customer.token)).statusCode,
    ).toBe(403);
    expect(
      (
        await call(
          "PUT",
          `/api/users/${admin.id}`,
          { fullName: "hacked" },
          customer.token,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(
          "DELETE",
          `/api/users/${admin.id}`,
          undefined,
          customer.token,
        )
      ).statusCode,
    ).toBe(403);
  });
});

describe("admin user management", () => {
  it("lists with pagination, search and filters", async () => {
    for (const n of ["alice", "bob", "carol"]) {
      await call(
        "POST",
        "/api/users",
        { fullName: n, email: `${n}@example.com`, password: "Secret123!" },
        admin.token,
      );
    }
    // admin + customer + 3 = 5 users
    const page = await call(
      "GET",
      "/api/users?perPage=2&page=2",
      undefined,
      admin.token,
    );
    expect(page.json().meta).toEqual({
      page: 2,
      perPage: 2,
      total: 5,
      totalPages: 3,
    });
    expect(page.json().data).toHaveLength(2);

    const search = await call(
      "GET",
      "/api/users?q=ALI",
      undefined,
      admin.token,
    ); // case-insensitive
    expect(
      search.json().data.map((u: { fullName: string }) => u.fullName),
    ).toEqual(["alice"]);

    const admins = await call(
      "GET",
      "/api/users?role=admin",
      undefined,
      admin.token,
    );
    expect(admins.json().meta.total).toBe(1);
  });

  it("treats % in a search as a literal, not a wildcard", async () => {
    const res = await call("GET", "/api/users?q=%25", undefined, admin.token); // q="%"
    expect(res.json().data).toHaveLength(0);
  });

  it("creates a verified user who can log in", async () => {
    const res = await call(
      "POST",
      "/api/users",
      {
        fullName: "Staff",
        email: "Staff@Example.com",
        password: "Secret123!",
        role: "admin",
      },
      admin.token,
    );
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({
      email: "staff@example.com",
      role: "admin",
    });
    expect(res.json().data.emailVerifiedAt).not.toBeNull();

    const login = await call("POST", "/api/auth/login", {
      email: "staff@example.com",
      password: "Secret123!",
    });
    expect(login.statusCode).toBe(200);
  });

  it("rejects a duplicate email (any case) with 409", async () => {
    const res = await call(
      "POST",
      "/api/users",
      {
        fullName: "Dup",
        email: customer.email.toUpperCase(),
        password: "Secret123!",
      },
      admin.token,
    );
    expect(res.statusCode).toBe(409);
  });

  it("gets one user, 404 for a missing one, 422 for a bad id", async () => {
    expect(
      (
        await call("GET", `/api/users/${customer.id}`, undefined, admin.token)
      ).json().data.email,
    ).toBe(customer.email);
    expect(
      (await call("GET", "/api/users/99999", undefined, admin.token))
        .statusCode,
    ).toBe(404);
    expect(
      (await call("GET", "/api/users/abc", undefined, admin.token)).statusCode,
    ).toBe(422);
  });

  it("updates a user; changing the email clears verification", async () => {
    const created = await call(
      "POST",
      "/api/users",
      { fullName: "Staff", email: "staff@example.com", password: "Secret123!" },
      admin.token,
    );
    const id = created.json().data.id;
    expect(created.json().data.emailVerifiedAt).not.toBeNull();

    const res = await call(
      "PUT",
      `/api/users/${id}`,
      { fullName: "Renamed", email: "new@example.com" },
      admin.token,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      fullName: "Renamed",
      email: "new@example.com",
      emailVerifiedAt: null,
    });
  });

  it("refuses an email that belongs to someone else", async () => {
    const res = await call(
      "PUT",
      `/api/users/${customer.id}`,
      { email: admin.email },
      admin.token,
    );
    expect(res.statusCode).toBe(409);
  });

  it("lets an admin reset a password, and the old one stops working", async () => {
    await call(
      "PUT",
      `/api/users/${customer.id}`,
      { password: "Brand-new-1" },
      admin.token,
    );
    expect(
      (
        await call("POST", "/api/auth/login", {
          email: customer.email,
          password: customer.password,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await call("POST", "/api/auth/login", {
          email: customer.email,
          password: "Brand-new-1",
        })
      ).statusCode,
    ).toBe(200);
  });

  it("can lock a user, who then cannot log in", async () => {
    await call(
      "PUT",
      `/api/users/${customer.id}`,
      { status: "locked" },
      admin.token,
    );
    expect(
      (
        await call("POST", "/api/auth/login", {
          email: customer.email,
          password: customer.password,
        })
      ).statusCode,
    ).toBe(403);
  });

  it("protects admins from locking, demoting or deleting themselves", async () => {
    expect(
      (
        await call(
          "PUT",
          `/api/users/${admin.id}`,
          { status: "locked" },
          admin.token,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(
          "PUT",
          `/api/users/${admin.id}`,
          { role: "customer" },
          admin.token,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await call("DELETE", `/api/users/${admin.id}`, undefined, admin.token))
        .statusCode,
    ).toBe(403);
  });

  it("deletes a user", async () => {
    expect(
      (
        await call(
          "DELETE",
          `/api/users/${customer.id}`,
          undefined,
          admin.token,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await call("GET", `/api/users/${customer.id}`, undefined, admin.token))
        .statusCode,
    ).toBe(404);
  });
});

import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { TEST_SECRETS, resetDb, testConfig } from "./helpers.js";

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp(testConfig());
});
afterAll(() => app.close());
beforeEach(() => resetDb(app.knex));

const creds = {
  fullName: "Nguyen Van A",
  email: "a@example.com",
  password: "Secret123!",
};

const call = (
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: Record<string, unknown>,
  token?: string,
) =>
  app.inject({
    method,
    url,
    payload,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

const register = (over: Record<string, unknown> = {}) =>
  call("POST", "/api/auth/register", { ...creds, ...over });
const login = (over: Record<string, unknown> = {}) =>
  call("POST", "/api/auth/login", {
    email: creds.email,
    password: creds.password,
    ...over,
  });

/** register + return the tokens */
async function signedUp() {
  const res = await register();
  return res.json().data.tokens as {
    accessToken: string;
    refreshToken: string;
  };
}

describe("register", () => {
  it("creates a customer and returns user + tokens, never the hash", async () => {
    const res = await register();
    expect(res.statusCode).toBe(201);
    const { user, tokens } = res.json().data;
    expect(user).toMatchObject({
      email: "a@example.com",
      fullName: "Nguyen Van A",
      role: "customer",
      status: "active",
    });
    expect(res.body).not.toContain("password");
    expect(tokens.tokenType).toBe("Bearer");
    expect(tokens.expiresIn).toBe(900);
  });

  it("stores a bcrypt hash, not the password", async () => {
    await register();
    const row = await app
      .knex("users")
      .where({ email: "a@example.com" })
      .first();
    expect(row.password_hash).toMatch(/^\$2[aby]\$/);
    expect(row.password_hash).not.toContain("Secret123!");
  });

  it("ignores a client-supplied role (no privilege escalation)", async () => {
    const res = await register({ role: "admin" });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.user.role).toBe("customer");
  });

  it("rejects a duplicate email regardless of case", async () => {
    await register();
    const res = await register({ email: "A@Example.COM" });
    expect(res.statusCode).toBe(409);
  });

  it("validates input and lists every bad field", async () => {
    const res = await register({ email: "nope", password: "short" });
    expect(res.statusCode).toBe(422);
    const fields = res
      .json()
      .errors.map((e: { field: string }) => e.field)
      .sort();
    expect(fields).toEqual(["email", "password"]);
  });
});

describe("login", () => {
  it("logs in with the right password (email case-insensitive)", async () => {
    await register();
    const res = await login({ email: "A@EXAMPLE.com" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.tokens.accessToken).toEqual(expect.any(String));
  });

  it("answers wrong password and unknown email identically", async () => {
    await register();
    const wrong = await login({ password: "Wrong-password" });
    const unknown = await login({ email: "ghost@example.com" });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().message).toBe(unknown.json().message);
  });

  it("refuses a locked account", async () => {
    await register();
    await app.knex("users").update({ status: "locked" });
    expect((await login()).statusCode).toBe(403);
  });

  it("is rate limited", async () => {
    const limited = await buildApp(testConfig({ AUTH_RATE_LIMIT_MAX: "2" }));
    try {
      const codes: number[] = [];
      for (let i = 0; i < 3; i++) {
        codes.push(
          (
            await limited.inject({
              method: "POST",
              url: "/api/auth/login",
              payload: { email: "x@y.co", password: "pw" },
            })
          ).statusCode,
        );
      }
      expect(codes).toEqual([401, 401, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe("GET /api/me (access token)", () => {
  it("requires a token", async () => {
    expect((await call("GET", "/api/me")).statusCode).toBe(401);
  });

  it("rejects garbage", async () => {
    expect(
      (await call("GET", "/api/me", undefined, "not-a-jwt")).statusCode,
    ).toBe(401);
  });

  it("rejects an expired token", async () => {
    const expired = jwt.sign({ role: "customer" }, TEST_SECRETS.access, {
      subject: "1",
      expiresIn: -10,
    });
    const res = await call("GET", "/api/me", undefined, expired);
    expect(res.statusCode).toBe(401);
    expect(res.json().message).toBe("Token expired");
  });

  it("rejects a refresh token used as an access token", async () => {
    const { refreshToken } = await signedUp();
    expect(
      (await call("GET", "/api/me", undefined, refreshToken)).statusCode,
    ).toBe(401);
  });

  it("returns the current user", async () => {
    const { accessToken } = await signedUp();
    const res = await call("GET", "/api/me", undefined, accessToken);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.email).toBe("a@example.com");
  });
});

describe("refresh rotation", () => {
  it("issues a new pair and revokes the old refresh token", async () => {
    const first = await signedUp();
    const res = await call("POST", "/api/auth/refresh", {
      refreshToken: first.refreshToken,
    });
    expect(res.statusCode).toBe(200);
    const second = res.json().data.tokens;
    expect(second.refreshToken).not.toBe(first.refreshToken);

    const rows = await app.knex("refresh_tokens").orderBy("created_at");
    expect(rows).toHaveLength(2);
    expect(rows[0].revoked_at).not.toBeNull();
    expect(rows[0].replaced_by).toBe(rows[1].id);
    expect(rows[1].family_id).toBe(rows[0].family_id); // same family
  });

  it("stores only a hash of the token", async () => {
    const { refreshToken } = await signedUp();
    const row = await app.knex("refresh_tokens").first();
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.token_hash).not.toContain(refreshToken);
  });

  it("detects reuse: replaying a rotated token kills the whole family", async () => {
    const first = await signedUp();
    const second = (
      await call("POST", "/api/auth/refresh", {
        refreshToken: first.refreshToken,
      })
    ).json().data.tokens;

    // an attacker (or a buggy client) replays the OLD token
    const replay = await call("POST", "/api/auth/refresh", {
      refreshToken: first.refreshToken,
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().message).toMatch(/reuse/i);

    // ...and the legitimate NEW token is dead too: everyone must log in again
    const legit = await call("POST", "/api/auth/refresh", {
      refreshToken: second.refreshToken,
    });
    expect(legit.statusCode).toBe(401);
    expect(
      await app.knex("refresh_tokens").whereNull("revoked_at"),
    ).toHaveLength(0);
  });

  it("lets exactly one of two concurrent refreshes win (row lock)", async () => {
    const { refreshToken } = await signedUp();
    const results = await Promise.all([
      call("POST", "/api/auth/refresh", { refreshToken }),
      call("POST", "/api/auth/refresh", { refreshToken }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
  });

  it("rejects an access token used as a refresh token", async () => {
    const { accessToken } = await signedUp();
    expect(
      (await call("POST", "/api/auth/refresh", { refreshToken: accessToken }))
        .statusCode,
    ).toBe(401);
  });

  it("blocks refresh for a locked user and revokes the session", async () => {
    const { refreshToken } = await signedUp();
    await app.knex("users").update({ status: "locked" });
    expect(
      (await call("POST", "/api/auth/refresh", { refreshToken })).statusCode,
    ).toBe(401);
    expect(
      await app.knex("refresh_tokens").whereNull("revoked_at"),
    ).toHaveLength(0);
  });
});

describe("logout", () => {
  it("revokes the session", async () => {
    const { refreshToken } = await signedUp();
    expect(
      (await call("POST", "/api/auth/logout", { refreshToken })).statusCode,
    ).toBe(200);
    expect(
      (await call("POST", "/api/auth/refresh", { refreshToken })).statusCode,
    ).toBe(401);
  });

  it("is idempotent for unknown tokens", async () => {
    const res = await call("POST", "/api/auth/logout", {
      refreshToken: "garbage-garbage-garbage",
    });
    expect(res.statusCode).toBe(200);
  });

  it("logout-all ends every session of the user", async () => {
    const a = await signedUp();
    const b = (await login()).json().data.tokens; // second device = second family
    expect(
      (await call("POST", "/api/auth/logout-all", undefined, a.accessToken))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await call("POST", "/api/auth/refresh", {
          refreshToken: a.refreshToken,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await call("POST", "/api/auth/refresh", {
          refreshToken: b.refreshToken,
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe("change password", () => {
  it("needs the current password", async () => {
    const { accessToken } = await signedUp();
    const res = await call(
      "PUT",
      "/api/auth/password",
      { currentPassword: "nope-nope", newPassword: "Brand-new-1" },
      accessToken,
    );
    expect(res.statusCode).toBe(401);
  });

  it("switches the password and signs out everywhere", async () => {
    const { accessToken, refreshToken } = await signedUp();
    const res = await call(
      "PUT",
      "/api/auth/password",
      { currentPassword: creds.password, newPassword: "Brand-new-1" },
      accessToken,
    );
    expect(res.statusCode).toBe(200);

    expect(
      (await call("POST", "/api/auth/refresh", { refreshToken })).statusCode,
    ).toBe(401);
    expect((await login()).statusCode).toBe(401); // old password
    expect((await login({ password: "Brand-new-1" })).statusCode).toBe(200);
  });
});

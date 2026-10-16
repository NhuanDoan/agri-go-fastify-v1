import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import {
  hashPassword,
  verifyPassword,
} from "../../src/common/security/password.js";
import { TokenService } from "../../src/common/security/token.service.js";
import { TEST_SECRETS } from "../helpers.js";

const make = (accessTtlSeconds = 60) =>
  new TokenService({
    accessSecret: TEST_SECRETS.access,
    refreshSecret: TEST_SECRETS.refresh,
    accessTtlSeconds,
    refreshTtlSeconds: 60,
  });

describe("passwords", () => {
  it("hashes (salted) and verifies", async () => {
    const a = await hashPassword("Secret123!", 4);
    const b = await hashPassword("Secret123!", 4);
    expect(a).not.toBe("Secret123!");
    expect(a).not.toBe(b); // different salt every time
    expect(await verifyPassword("Secret123!", a)).toBe(true);
    expect(await verifyPassword("wrong", a)).toBe(false);
  });

  it("verifies Laravel-style $2y$ hashes", async () => {
    const laravel = (await hashPassword("Secret123!", 4))
      .replace("$2b$", "$2y$")
      .replace("$2a$", "$2y$");
    expect(laravel.startsWith("$2y$")).toBe(true);
    expect(await verifyPassword("Secret123!", laravel)).toBe(true);
  });
});

describe("TokenService", () => {
  it("round-trips an access token", () => {
    const svc = make();
    expect(svc.verifyAccess(svc.signAccess({ id: 7, role: "admin" }))).toEqual({
      id: 7,
      role: "admin",
    });
  });

  it("round-trips a refresh token", () => {
    const svc = make();
    const t = svc.signRefresh({ userId: 7, jti: "j-1", familyId: "f-1" });
    expect(svc.verifyRefresh(t)).toEqual({
      userId: 7,
      jti: "j-1",
      familyId: "f-1",
    });
  });

  it("keeps access and refresh tokens apart (different secrets)", () => {
    const svc = make();
    const access = svc.signAccess({ id: 1, role: "customer" });
    const refresh = svc.signRefresh({ userId: 1, jti: "j", familyId: "f" });
    expect(() => svc.verifyRefresh(access)).toThrow();
    expect(() => svc.verifyAccess(refresh)).toThrow();
  });

  it('rejects tampered, foreign and "alg none" tokens', () => {
    const svc = make();
    const good = svc.signAccess({ id: 1, role: "customer" });
    expect(() => svc.verifyAccess(good.slice(0, -2) + "xx")).toThrow();
    expect(() =>
      svc.verifyAccess(
        jwt.sign({ role: "admin" }, "another-secret-another-secret-123456", {
          subject: "1",
        }),
      ),
    ).toThrow();
    const none = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" }),
    ).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({ sub: "1", role: "admin" }),
    ).toString("base64url");
    expect(() => svc.verifyAccess(`${none}.${body}.`)).toThrow();
  });

  it('says "expired" for an expired token', () => {
    const svc = make(-10);
    expect(() =>
      svc.verifyAccess(svc.signAccess({ id: 1, role: "customer" })),
    ).toThrow("Token expired");
  });

  it("hashes tokens to 64 hex chars, deterministically", () => {
    const svc = make();
    expect(svc.hash("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(svc.hash("abc")).toBe(svc.hash("abc"));
  });
});

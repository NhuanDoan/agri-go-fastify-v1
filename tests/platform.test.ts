import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { testConfig } from "./helpers.js";

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp(testConfig());
});
afterAll(() => app.close());
afterEach(() => {
  app.draining = false;
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("request ids", () => {
  it("keeps a sane upstream id, so one request can be traced across proxies and logs", async () => {
    const res = await app.inject({
      url: "/health",
      headers: { "x-request-id": "gw-7f3a.42" },
    });
    expect(res.headers["x-request-id"]).toBe("gw-7f3a.42");
  });

  it("mints a UUID when none is sent", async () => {
    expect(
      (await app.inject({ url: "/health" })).headers["x-request-id"],
    ).toMatch(UUID);
  });

  it.each([
    "has spaces",
    "x".repeat(65),
    "<script>alert(1)</script>",
    "semi;colon",
  ])("replaces an unsafe id: %s", async (bad) => {
    const res = await app.inject({
      url: "/health",
      headers: { "x-request-id": bad },
    });
    expect(res.headers["x-request-id"]).toMatch(UUID);
  });

  it("is on error responses too, and matches the id inside the body", async () => {
    const notFound = await app.inject({ url: "/nope" });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json().requestId).toBe(notFound.headers["x-request-id"]);

    const invalid = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {},
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().requestId).toBe(invalid.headers["x-request-id"]);

    const unauthorized = await app.inject({ url: "/api/me" });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.headers["x-request-id"]).toMatch(UUID);
  });
});

describe("health probes", () => {
  it("reports ready when the database answers", async () => {
    expect((await app.inject({ url: "/health/ready" })).json()).toEqual({
      status: "ready",
    });
  });

  it("turns readiness to 503 while draining, but keeps liveness green", async () => {
    app.draining = true;
    const ready = await app.inject({ url: "/health/ready" });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ status: "draining" });
    expect((await app.inject({ url: "/health" })).statusCode).toBe(200); // a draining instance must NOT be restarted
  });

  it("answers 503 quickly, and liveness stays green, when the database is gone", async () => {
    const broken = await buildApp(testConfig());
    try {
      await broken.knex.destroy();
      const started = Date.now();
      const ready = await broken.inject({ url: "/health/ready" });
      expect(ready.statusCode).toBe(503);
      expect(ready.json()).toEqual({ status: "unavailable" });
      expect(Date.now() - started).toBeLessThan(2500);
      expect((await broken.inject({ url: "/health" })).statusCode).toBe(200);
    } finally {
      await broken.close();
    }
  });
});

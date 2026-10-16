import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../src/common/errors/app-error.js";
import { testConfig } from "./helpers.js";

let app: FastifyInstance;
afterEach(() => app.close());

async function appWith(
  register: (a: FastifyInstance) => void,
  overrides: Record<string, string> = {},
) {
  app = await buildApp(testConfig(overrides));
  register(app);
  return app;
}

describe("error handler", () => {
  it("maps AppError to its status and the envelope", async () => {
    await appWith((a) =>
      a.get("/t", async () => {
        throw new NotFoundError("Widget not found");
      }),
    );
    const res = await app.inject({ url: "/t" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      success: false,
      message: "Widget not found",
      requestId: expect.any(String),
    });
  });

  it("passes AppError details through", async () => {
    await appWith((a) =>
      a.get("/t", async () => {
        throw new ConflictError("Taken", [{ field: "email" }]);
      }),
    );
    const res = await app.inject({ url: "/t" });
    expect(res.statusCode).toBe(409);
    expect(res.json().errors).toEqual([{ field: "email" }]);
  });

  it("returns 422 listing every invalid field", async () => {
    await appWith((a) =>
      a.post(
        "/t",
        {
          schema: {
            body: Type.Object({
              email: Type.String({ format: "email" }),
              age: Type.Integer({ minimum: 18 }),
            }),
          },
        },
        async () => ({}),
      ),
    );
    const res = await app.inject({
      method: "POST",
      url: "/t",
      payload: { email: "nope", age: 5 },
    });
    expect(res.statusCode).toBe(422);
    const fields = res
      .json()
      .errors.map((e: { field: string }) => e.field)
      .sort();
    expect(fields).toEqual(["age", "email"]);
  });

  it("names missing required fields", async () => {
    await appWith((a) =>
      a.post(
        "/t",
        { schema: { body: Type.Object({ email: Type.String() }) } },
        async () => ({}),
      ),
    );
    const res = await app.inject({ method: "POST", url: "/t", payload: {} });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors[0]).toMatchObject({ in: "body", field: "email" });
  });

  it("answers malformed JSON with 400 in the envelope", async () => {
    await appWith((a) => a.post("/t", async () => ({})));
    const res = await app.inject({
      method: "POST",
      url: "/t",
      payload: "{bad",
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
  });

  it("hides the message of unexpected errors", async () => {
    await appWith((a) =>
      a.get("/t", async () => {
        throw new Error("secret db password is hunter2");
      }),
    );
    const res = await app.inject({ url: "/t" });
    expect(res.statusCode).toBe(500);
    expect(res.json().message).toBe("Internal server error");
    expect(res.body).not.toContain("hunter2");
  });

  it("maps a PostgreSQL unique violation to 409", async () => {
    await appWith((a) =>
      a.get("/t", async () => {
        throw Object.assign(new Error("dup"), { code: "23505" });
      }),
    );
    const res = await app.inject({ url: "/t" });
    expect(res.statusCode).toBe(409);
  });

  it("answers unknown routes with the envelope", async () => {
    await appWith(() => {});
    const res = await app.inject({ url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      success: false,
      message: "Route GET /nope not found",
    });
  });

  it("passes a machine-readable code through, and omits it otherwise", async () => {
    await appWith((a) => {
      a.get("/coded", async () => {
        throw new ForbiddenError("Verify first", "EMAIL_NOT_VERIFIED");
      });
      a.get("/plain", async () => {
        throw new ForbiddenError("No");
      });
    });
    const coded = await app.inject({ url: "/coded" });
    expect(coded.statusCode).toBe(403);
    expect(coded.json()).toMatchObject({
      success: false,
      message: "Verify first",
      code: "EMAIL_NOT_VERIFIED",
    });
    expect((await app.inject({ url: "/plain" })).json()).not.toHaveProperty(
      "code",
    );
  });
});

describe("platform middleware", () => {
  it("rate limits with the envelope", async () => {
    await appWith((a) => a.get("/t", async () => ({})), {
      RATE_LIMIT_MAX: "2",
    });
    const codes = [];
    for (let i = 0; i < 3; i++)
      codes.push((await app.inject({ url: "/t" })).statusCode);
    expect(codes).toEqual([200, 200, 429]);
    const blocked = await app.inject({ url: "/t" });
    expect(blocked.json()).toMatchObject({ success: false });
  });

  it("never rate limits health checks", async () => {
    await appWith(() => {}, { RATE_LIMIT_MAX: "1" });
    for (let i = 0; i < 5; i++)
      expect((await app.inject({ url: "/health" })).statusCode).toBe(200);
  });

  it("sends security headers and CORS", async () => {
    await appWith(() => {});
    const res = await app.inject({
      url: "/health",
      headers: { origin: "http://localhost:5173" },
    });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("documents routes in the OpenAPI spec", async () => {
    await appWith(() => {});
    const res = await app.inject({ url: "/docs/json" });
    expect(res.statusCode).toBe(200);
    expect(res.json().paths["/health"]).toBeDefined();
  });
});

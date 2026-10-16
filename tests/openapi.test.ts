import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { TEST_SECRETS, VNPAY_TEST, testConfig, vnpayEnv } from "./helpers.js";

let app: FastifyInstance;
let spec: { paths: Record<string, Record<string, any>> };

beforeAll(async () => {
  app = await buildApp(testConfig(vnpayEnv()));
  spec = (await app.inject({ url: "/docs/json" })).json();
});

afterAll(() => app.close());

const operations = () =>
  Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([method]) =>
        ["get", "post", "put", "patch", "delete"].includes(method),
      )
      .map(([method, op]) => ({
        label: `${method.toUpperCase()} ${path}`,
        op,
      })),
  );

describe("OpenAPI spec", () => {
  it("covers the whole API surface", () => {
    for (const path of [
      "/api/auth/login",
      "/api/auth/refresh",
      "/api/me",
      "/api/products",
      "/api/orders/checkout",
      "/api/payments/vnpay/ipn",
      "/api/products/{id}/reviews",
      "/api/chat/rooms",
      "/health/ready",
    ]) {
      expect(spec.paths[path], path).toBeDefined();
    }
    expect(operations().length).toBeGreaterThan(50);
  });

  it("gives every operation a summary and a tag", () => {
    const missing = operations()
      .filter(({ op }) => !op.summary || !op.tags?.length)
      .map((o) => o.label);
    expect(missing).toEqual([]);
  });

  it("documents a 401 on every operation that needs a token", () => {
    const missing = operations()
      .filter(({ op }) => op.security?.length && !op.responses?.["401"])
      .map((o) => o.label);
    expect(missing).toEqual([]);
  });

  it("never leaks a secret into the spec", () => {
    const text = JSON.stringify(spec);
    for (const secret of [
      TEST_SECRETS.access,
      TEST_SECRETS.refresh,
      VNPAY_TEST.hashSecret,
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});

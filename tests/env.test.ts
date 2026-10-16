import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";

const base = {
  DB_NAME: "x",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
  OTP_SECRET: "c".repeat(32),
};

const prod = {
  ...base,
  NODE_ENV: "production",
  MAIL_TRANSPORT: "smtp",
  CORS_ORIGINS: "https://shop.example",
  DB_PASSWORD: "a-real-password",
};

describe("boolean env flags", () => {
  it("defaults DB_SSL to the boolean false, not the string false", () => {
    expect(loadConfig(base).DB_SSL).toBe(false);
  });

  it('parses "true" and "false"', () => {
    expect(loadConfig({ ...base, DB_SSL: "true" }).DB_SSL).toBe(true);
    expect(loadConfig({ ...base, DB_SSL: "false" }).DB_SSL).toBe(false);
  });

  it("rejects anything else", () => {
    expect(() => loadConfig({ ...base, DB_SSL: "yes" })).toThrow(/DB_SSL/);
  });

  it("refuses identical JWT secrets", () => {
    expect(() =>
      loadConfig({
        ...base,
        JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET,
      }),
    ).toThrow(/JWT_REFRESH_SECRET/);
  });

  it("defaults SMTP_SECURE to the boolean false", () => {
    expect(loadConfig(base).SMTP_SECURE).toBe(false);
  });

  it("parses SHIPPING_FEE with a default of 0", () => {
    expect(loadConfig(base).SHIPPING_FEE).toBe(0);
    expect(loadConfig({ ...base, SHIPPING_FEE: "30000" }).SHIPPING_FEE).toBe(
      30000,
    );
  });

  it("treats VNPay as optional but requires its two credentials together", () => {
    expect(loadConfig(base).VNPAY_TMN_CODE).toBeUndefined();

    expect(
      loadConfig({
        ...base,
        VNPAY_TMN_CODE: "X",
        VNPAY_HASH_SECRET: "Y",
      }).VNPAY_TMN_CODE,
    ).toBe("X");

    expect(() => loadConfig({ ...base, VNPAY_TMN_CODE: "X" })).toThrow(
      /VNPAY_HASH_SECRET/,
    );
  });

  it("defaults the VNPay window and URLs", () => {
    const cfg = loadConfig(base);

    expect(cfg.VNPAY_EXPIRE_MINUTES).toBe(15);
    expect(cfg.VNPAY_URL).toContain("sandbox.vnpayment.vn");
  });
});

describe("production safety", () => {
  it("accepts a complete production configuration", () => {
    expect(loadConfig(prod).NODE_ENV).toBe("production");
  });

  it("requires a real mail transport (the log transport prints OTP codes)", () => {
    expect(() => loadConfig({ ...prod, MAIL_TRANSPORT: "log" })).toThrow(
      /MAIL_TRANSPORT/,
    );
  });

  it('refuses CORS "*" in production but allows it in development', () => {
    expect(() => loadConfig({ ...prod, CORS_ORIGINS: "*" })).toThrow(
      /CORS_ORIGINS/,
    );

    expect(loadConfig({ ...base, CORS_ORIGINS: "*" }).CORS_ORIGINS).toBe("*");
  });

  it("refuses the .env.example placeholder secrets", () => {
    const placeholder = "change-me-please-0123456789abcdef0123";

    for (const key of [
      "JWT_ACCESS_SECRET",
      "JWT_REFRESH_SECRET",
      "OTP_SECRET",
    ] as const) {
      expect(() => loadConfig({ ...prod, [key]: placeholder })).toThrow(
        /placeholders/,
      );
    }
  });

  it("refuses an empty database password", () => {
    expect(() => loadConfig({ ...prod, DB_PASSWORD: "" })).toThrow(
      /DB_PASSWORD/,
    );
  });

  it("refuses example database passwords", () => {
    for (const DB_PASSWORD of ["secret", "ChangeMe-db-password"]) {
      expect(() => loadConfig({ ...prod, DB_PASSWORD })).toThrow(/DB_PASSWORD/);
    }
  });
});

describe("operational settings", () => {
  it("has sensible defaults", () => {
    expect(loadConfig(base)).toMatchObject({
      DB_ACQUIRE_TIMEOUT_MS: 10000,
      REQUEST_TIMEOUT_MS: 30000,
      KEEP_ALIVE_TIMEOUT_MS: 65000,
      SHUTDOWN_DELAY_SECONDS: 0,
      SHUTDOWN_TIMEOUT_SECONDS: 20,
    });
  });

  it("rejects absurd values", () => {
    expect(() =>
      loadConfig({ ...base, SHUTDOWN_TIMEOUT_SECONDS: "0" }),
    ).toThrow(/SHUTDOWN_TIMEOUT_SECONDS/);

    expect(() => loadConfig({ ...base, REQUEST_TIMEOUT_MS: "5" })).toThrow(
      /REQUEST_TIMEOUT_MS/,
    );
  });

  it("keeps .env.example loadable, so a new variable is never forgotten there", () => {
    expect(() =>
      loadConfig(parseEnv(readFileSync(".env.example", "utf8"))),
    ).not.toThrow();
  });
});

it("defaults the mail lease and rejects one shorter than a single send", () => {
  expect(loadConfig(base).MAIL_LEASE_SECONDS).toBe(120);

  expect(() => loadConfig({ ...base, MAIL_LEASE_SECONDS: "10" })).toThrow(
    /MAIL_LEASE_SECONDS/,
  );
});

import { describe, expect, it } from "vitest";
import {
  VnpayClient,
  formatVnpDate,
  normalizeIp,
  parseVnpDate,
} from "../../src/modules/payments/vnpay.js";
import { signVnpay } from "../helpers.js";

const client = new VnpayClient({
  tmnCode: "TESTCODE",
  hashSecret: "SECRETKEY",
  url: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
  returnUrl: "http://localhost:3000/api/payments/vnpay/return",
  expireMinutes: 15,
});

const input = {
  txnRef: "AG250101ABCDEF12R1",
  amount: 180000,
  orderInfo: "Thanh toan don hang AG250101ABCDEF12",
  ipAddr: "127.0.0.1",
  now: new Date("2025-01-01T03:00:00.000Z"), // 10:00:00 in Vietnam
};

/**
 * Computed ONCE with a standalone script that follows VNPay's published Node sample
 * (sortObject + qs.stringify(encode:false) + HMAC-SHA512). If this ever fails, the encoding or the
 * signing changed, and real VNPay would answer "invalid signature" (code 70).
 */
const REFERENCE_HASH =
  "d31ae14bee99c808e911aaa8daccd1d56965618fb9ad7f3d46b2a6cf6c1b13c893fcdfafe17d8912cde58c5efdae4b1d1c8145492fdd4bea5a06210be9e4f0b4";

const queryOf = (url: string) =>
  Object.fromEntries(new URL(url).searchParams) as Record<string, string>;

describe("VnpayClient.createPaymentUrl", () => {
  it("produces the reference signature", () => {
    const { url } = client.createPaymentUrl(input);
    expect(url.endsWith(`&vnp_SecureHash=${REFERENCE_HASH}`)).toBe(true);
  });

  it("encodes parameters the way VNPay signs them", () => {
    const { url } = client.createPaymentUrl(input);
    expect(
      url.startsWith("https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?"),
    ).toBe(true);
    expect(url).toContain("vnp_Amount=18000000"); // amount x 100
    expect(url).toContain("vnp_CreateDate=20250101100000"); // GMT+7
    expect(url).toContain("vnp_ExpireDate=20250101101500"); // + 15 minutes
    expect(url).toContain("vnp_OrderInfo=Thanh+toan+don+hang+AG250101ABCDEF12"); // space is "+"
    expect(url).toContain(
      "vnp_ReturnUrl=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fpayments%2Fvnpay%2Freturn",
    );
  });

  it("reports when the link expires", () => {
    expect(client.createPaymentUrl(input).expiresAt.toISOString()).toBe(
      "2025-01-01T03:15:00.000Z",
    );
  });

  it("agrees with the independent signer used by the tests", () => {
    const { vnp_SecureHash, ...params } = queryOf(
      client.createPaymentUrl(input).url,
    );
    expect(vnp_SecureHash).toBe(REFERENCE_HASH);
    expect(signVnpay(params, "SECRETKEY")).toBe(REFERENCE_HASH);
  });
});

describe("VnpayClient.verify", () => {
  const signed = () => queryOf(client.createPaymentUrl(input).url);

  it("accepts what it signed itself", () => {
    expect(client.verify(signed())).toBe(true);
  });

  it("is case-insensitive about the hex digest", () => {
    const q = signed();
    expect(
      client.verify({ ...q, vnp_SecureHash: q.vnp_SecureHash!.toUpperCase() }),
    ).toBe(true);
  });

  it("rejects a changed amount, txn ref or response code", () => {
    expect(client.verify({ ...signed(), vnp_Amount: "100" })).toBe(false);
    expect(client.verify({ ...signed(), vnp_TxnRef: "OTHER" })).toBe(false);
    expect(client.verify({ ...signed(), vnp_ResponseCode: "00" })).toBe(false); // an added parameter breaks it too
  });

  it("rejects a removed parameter", () => {
    const { vnp_Amount: _removed, ...rest } = signed();
    expect(client.verify(rest)).toBe(false);
  });

  it("rejects a missing, wrong or empty signature", () => {
    const { vnp_SecureHash: _hash, ...rest } = signed();
    expect(client.verify(rest)).toBe(false);
    expect(client.verify({ ...rest, vnp_SecureHash: "abc" })).toBe(false);
    expect(client.verify({ ...rest, vnp_SecureHash: "" })).toBe(false);
    expect(client.verify({})).toBe(false);
  });

  it("rejects a signature made with another secret", () => {
    const { vnp_SecureHash: _hash, ...rest } = signed();
    expect(
      client.verify({
        ...rest,
        vnp_SecureHash: signVnpay(rest, "OTHER-SECRET"),
      }),
    ).toBe(false);
  });

  it("rejects a repeated parameter (arrives as an array)", () => {
    expect(client.verify({ ...signed(), vnp_TxnRef: ["A", "B"] })).toBe(false);
  });

  it("ignores parameters that are not vnp_*", () => {
    expect(client.verify({ ...signed(), utm_source: "newsletter" })).toBe(true);
  });

  it("ignores vnp_SecureHashType", () => {
    expect(
      client.verify({ ...signed(), vnp_SecureHashType: "HmacSHA512" }),
    ).toBe(true);
  });
});

describe("date and ip helpers", () => {
  it("formats and parses Vietnam time", () => {
    expect(formatVnpDate(new Date("2025-01-01T03:00:00.000Z"))).toBe(
      "20250101100000",
    );
    expect(formatVnpDate(new Date("2025-01-01T20:00:00.000Z"))).toBe(
      "20250102030000",
    ); // crosses midnight
    expect(parseVnpDate("20250101103000")?.toISOString()).toBe(
      "2025-01-01T03:30:00.000Z",
    );
  });

  it("rejects malformed dates", () => {
    expect(parseVnpDate(undefined)).toBeNull();
    expect(parseVnpDate("2025-01-01")).toBeNull();
    expect(parseVnpDate("20251301250000")).toBeNull();
  });

  it("simplifies loopback and IPv4-mapped addresses", () => {
    expect(normalizeIp("::1")).toBe("127.0.0.1");
    expect(normalizeIp("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(normalizeIp("203.0.113.9")).toBe("203.0.113.9");
  });
});

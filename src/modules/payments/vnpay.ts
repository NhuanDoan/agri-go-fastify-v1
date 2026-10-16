import { createHmac, timingSafeEqual } from "node:crypto";

export interface VnpayConfig {
  tmnCode: string;
  hashSecret: string;
  url: string; // sandbox or production gateway
  returnUrl: string; // where VNPay sends the customer's BROWSER afterwards
  expireMinutes: number;
}

/** VNPay signs the URL-encoded form with spaces as "+" (this matches its official sample code). */
const enc = (v: string): string => encodeURIComponent(v).replace(/%20/g, "+");

function signData(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${enc(k)}=${enc(params[k]!)}`)
    .join("&");
}

/** yyyyMMddHHmmss in Vietnam time (GMT+7): the only zone VNPay accepts. */
export function formatVnpDate(d: Date): string {
  return new Date(d.getTime() + 7 * 3_600_000)
    .toISOString()
    .replace(/\D/g, "")
    .slice(0, 14);
}

export function parseVnpDate(s: string | undefined): Date | null {
  if (!s || !/^\d{14}$/.test(s)) return null;
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}+07:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** VNPay is picky about IPv6 forms; send a plain IPv4 whenever possible. */
export function normalizeIp(ip: string): string {
  if (ip === "::1") return "127.0.0.1";
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

export class VnpayClient {
  constructor(private readonly cfg: VnpayConfig) {}

  signature(params: Record<string, string>): string {
    return createHmac("sha512", this.cfg.hashSecret)
      .update(Buffer.from(signData(params), "utf-8"))
      .digest("hex");
  }

  createPaymentUrl(i: {
    txnRef: string;
    amount: number; // VND, integer
    orderInfo: string; // ASCII only, no special characters
    ipAddr: string;
    now?: Date;
  }): { url: string; expiresAt: Date } {
    const now = i.now ?? new Date();
    const expiresAt = new Date(now.getTime() + this.cfg.expireMinutes * 60_000);
    const params: Record<string, string> = {
      vnp_Version: "2.1.0",
      vnp_Command: "pay",
      vnp_TmnCode: this.cfg.tmnCode,
      vnp_Locale: "vn",
      vnp_CurrCode: "VND",
      vnp_TxnRef: i.txnRef,
      vnp_OrderInfo: i.orderInfo,
      vnp_OrderType: "other",
      vnp_Amount: String(i.amount * 100), // VNPay wants amount x 100
      vnp_ReturnUrl: this.cfg.returnUrl,
      vnp_IpAddr: i.ipAddr,
      vnp_CreateDate: formatVnpDate(now),
      vnp_ExpireDate: formatVnpDate(expiresAt),
    };
    return {
      url: `${this.cfg.url}?${signData(params)}&vnp_SecureHash=${this.signature(params)}`,
      expiresAt,
    };
  }

  /**
   * True only if VNPay itself signed this callback with our secret.
   * Every vnp_* parameter takes part, so adding, removing or repeating one (Fastify turns a repeated
   * parameter into an array, which is skipped here) breaks the signature.
   */
  verify(query: Record<string, unknown>): boolean {
    const received = query.vnp_SecureHash;
    if (typeof received !== "string") return false;

    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      if (
        key.startsWith("vnp_") &&
        key !== "vnp_SecureHash" &&
        key !== "vnp_SecureHashType" &&
        typeof value === "string"
      ) {
        params[key] = value;
      }
    }
    const expected = Buffer.from(this.signature(params).toLowerCase());
    const actual = Buffer.from(received.toLowerCase());
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }
}

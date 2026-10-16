import { loadConfig } from "../src/config/env.js";
import { VnpayClient } from "../src/modules/payments/vnpay.js";

// usage: pnpm vnpay:ipn <txnRef> <amountVND> [responseCode=00]
const [txnRef, amountArg, responseCode = "00"] = process.argv.slice(2);
if (!txnRef || !amountArg)
  throw new Error("Usage: pnpm vnpay:ipn <txnRef> <amountVND> [responseCode]");

const config = loadConfig();
if (!config.VNPAY_TMN_CODE || !config.VNPAY_HASH_SECRET)
  throw new Error("Set VNPAY_TMN_CODE and VNPAY_HASH_SECRET in .env");

const client = new VnpayClient({
  tmnCode: config.VNPAY_TMN_CODE,
  hashSecret: config.VNPAY_HASH_SECRET,
  url: config.VNPAY_URL,
  returnUrl: config.VNPAY_RETURN_URL,
  expireMinutes: config.VNPAY_EXPIRE_MINUTES,
});

const now = new Date(Date.now() + 7 * 3_600_000)
  .toISOString()
  .replace(/\D/g, "")
  .slice(0, 14); // GMT+7
const params: Record<string, string> = {
  vnp_Amount: String(Number(amountArg) * 100),
  vnp_BankCode: "NCB",
  vnp_BankTranNo: "VNP00000000",
  vnp_CardType: "ATM",
  vnp_OrderInfo: `Thanh toan ${txnRef}`,
  vnp_PayDate: now,
  vnp_ResponseCode: responseCode,
  vnp_TmnCode: config.VNPAY_TMN_CODE,
  vnp_TransactionNo: String(Date.now()).slice(-8),
  vnp_TransactionStatus: responseCode === "00" ? "00" : "02",
  vnp_TxnRef: txnRef,
};
const query = new URLSearchParams({
  ...params,
  vnp_SecureHash: client.signature(params),
});
const res = await fetch(
  `http://localhost:${config.PORT}/api/payments/vnpay/ipn?${query}`,
);
console.log(res.status, await res.text());

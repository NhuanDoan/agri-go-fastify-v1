import { Type, type Static } from "@sinclair/typebox";
import {
  Nullable,
  PaginationQuery,
  StringEnum,
} from "../../common/schemas/common.js";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "../orders/orders.types.js";

export const RefundSchema = Type.Object({
  paymentId: Type.Integer(),
  txnRef: Type.String(),
  providerTxnNo: Nullable(Type.String()), // VNPay's own transaction number: what you look up in their portal
  bankCode: Nullable(Type.String()),
  amount: Type.Integer(),
  paidAt: Nullable(Type.String()),
  refundStatus: StringEnum(["pending", "refunded"] as const),
  refundReason: Nullable(Type.String()),
  refundedAt: Nullable(Type.String()),
  refundedBy: Nullable(Type.Integer()),
  order: Type.Object({
    id: Type.Integer(),
    orderCode: Type.String(),
    orderStatus: StringEnum(ORDER_STATUSES),
    paymentStatus: StringEnum(PAYMENT_STATUSES),
  }),
});
export type RefundDto = Static<typeof RefundSchema>;

export const ListRefundsQuery = Type.Composite([
  PaginationQuery,
  Type.Object({
    status: Type.Optional(StringEnum(["pending", "refunded", "all"] as const)),
  }), // default: pending
]);
export type ListRefundsQuery = Static<typeof ListRefundsQuery>;

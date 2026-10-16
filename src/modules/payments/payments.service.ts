import type { FastifyBaseLogger } from "fastify";
import type { Knex } from "knex";
import {
  AppError,
  ConflictError,
  NotFoundError,
} from "../../common/errors/app-error.js";
import type { Paged } from "../../common/utils/pagination.js";
import type { MailService } from "../mail/mail.service.js";
import type { OrdersRepository } from "../orders/orders.repository.js";
import type { UsersRepository } from "../users/users.repository.js";
import type {
  PaymentsRepository,
  RefundListStatus,
} from "./payments.repository.js";
import type { PaymentRow, RefundRow } from "./payments.types.js";
import { normalizeIp, parseVnpDate, type VnpayClient } from "./vnpay.js";

export interface PaymentLink {
  paymentUrl: string;
  txnRef: string;
  expiresAt: Date;
}

export interface IpnResponse {
  RspCode: string;
  Message: string;
}

type Query = Record<string, unknown>;

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

/**
 * LOCK ORDER (what keeps these paths deadlock-free): the ORDER row first, then payment rows that have
 * ALREADY succeeded. The one path that locks a payment first is the IPN (it finds the payment from the gateway's
 * reference), and it only ever locks a PENDING payment before taking the order lock: rows the order-first paths never touch.
 */
export class PaymentsService {
  constructor(
    private readonly knex: Knex,
    private readonly payments: PaymentsRepository,
    private readonly orders: OrdersRepository,
    private readonly users: UsersRepository,
    private readonly mail: MailService,
    private readonly vnpay: VnpayClient | null,
    private readonly cfg: {
      frontendResultUrl: string;
      unpaidGraceMinutes: number;
    },
    private readonly log: FastifyBaseLogger,
  ) {}

  assertVnpayConfigured(): VnpayClient {
    if (!this.vnpay)
      throw new AppError(503, "VNPay is not configured on this server");
    return this.vnpay;
  }

  async createVnpayPayment(orderId: number, ip: string): Promise<PaymentLink> {
    const vnpay = this.assertVnpayConfigured();

    return this.knex.transaction(async (trx) => {
      const order = await this.orders.findByIdForUpdate(trx, orderId);
      if (!order) throw new NotFoundError("Order not found");
      if (order.payment_method !== "vnpay")
        throw new ConflictError("This is not a VNPay order");
      if (
        order.order_status !== "pending" ||
        order.payment_status !== "unpaid"
      ) {
        throw new ConflictError("This order can no longer be paid");
      }
      if (
        Date.now() >
        order.created_at.getTime() + this.cfg.unpaidGraceMinutes * 60_000
      ) {
        throw new ConflictError(
          "The payment window for this order has expired",
        );
      }

      const attempt = (await this.payments.countByOrder(trx, order.id)) + 1;
      const txnRef = `${order.order_code}R${attempt}`;
      const { url, expiresAt } = vnpay.createPaymentUrl({
        txnRef,
        amount: order.total_price,
        orderInfo: `Thanh toan don hang ${order.order_code}`,
        ipAddr: normalizeIp(ip),
      });
      await this.payments.insert(trx, {
        order_id: order.id,
        provider: "vnpay",
        txn_ref: txnRef,
        amount: order.total_price,
        expires_at: expiresAt,
      });
      return { paymentUrl: url, txnRef, expiresAt };
    });
  }

  async handleIpn(query: Query): Promise<IpnResponse> {
    if (!this.vnpay || !this.vnpay.verify(query))
      return { RspCode: "97", Message: "Invalid signature" };
    const txnRef = str(query.vnp_TxnRef);

    try {
      return await this.knex.transaction<IpnResponse>(async (trx) => {
        const payment = txnRef
          ? await this.payments.findByTxnRefForUpdate(trx, txnRef)
          : undefined;
        if (!payment) return { RspCode: "01", Message: "Order not found" };
        if (Number(str(query.vnp_Amount)) !== payment.amount * 100)
          return { RspCode: "04", Message: "Invalid amount" };
        if (payment.status !== "pending")
          return { RspCode: "02", Message: "Order already confirmed" };

        const success =
          str(query.vnp_ResponseCode) === "00" &&
          str(query.vnp_TransactionStatus) === "00";
        const paidAt = parseVnpDate(str(query.vnp_PayDate)) ?? new Date();
        await this.payments.update(trx, payment.id, {
          status: success ? "success" : "failed",
          provider_txn_no: str(query.vnp_TransactionNo) ?? null,
          bank_code: str(query.vnp_BankCode) ?? null,
          response_code: str(query.vnp_ResponseCode) ?? null,
          paid_at: success ? paidAt : null,
          raw_payload: Object.fromEntries(
            Object.entries(query).filter(
              ([k, v]) => k.startsWith("vnp_") && typeof v === "string",
            ),
          ),
        });
        if (success) await this.applySuccess(trx, payment, paidAt);
        return { RspCode: "00", Message: "Confirm Success" };
      });
    } catch (err) {
      this.log.error({ err, txnRef }, "VNPay IPN processing failed");
      return { RspCode: "99", Message: "Unknown error" };
    }
  }

  async resultRedirectUrl(query: Query): Promise<string> {
    const url = new URL(this.cfg.frontendResultUrl);
    const to = (status: string, orderCode?: string): string => {
      url.searchParams.set("status", status);
      if (orderCode) url.searchParams.set("orderCode", orderCode);
      return url.toString();
    };
    if (!this.vnpay || !this.vnpay.verify(query)) return to("invalid");

    const payment = await this.payments.findByTxnRef(
      this.knex,
      str(query.vnp_TxnRef) ?? "",
    );
    if (!payment) return to("invalid");
    const orderCode = (await this.orders.findById(this.knex, payment.order_id))
      ?.order_code;

    if (payment.status === "success") return to("success", orderCode);
    if (payment.status === "failed" || str(query.vnp_ResponseCode) !== "00")
      return to("failed", orderCode);
    return to("processing", orderCode);
  }

  // ---------------------------------------------------------------- refunds

  /** Used inside the cancel transaction: the money of a PAID order that gets cancelled must go back. */
  flagRefundForOrder(
    trx: Knex.Transaction,
    orderId: number,
    reason: string,
  ): Promise<number> {
    return this.payments.flagRefundForOrder(trx, orderId, reason);
  }

  listRefunds(
    status: RefundListStatus,
    page: number,
    perPage: number,
  ): Promise<Paged<RefundRow>> {
    return this.payments.listRefunds(this.knex, status, page, perPage);
  }

  /** Admin: ONE payment was paid back (done in the VNPay portal). */
  async recordRefund(paymentId: number, actorId: number): Promise<RefundRow> {
    const found = await this.payments.findById(this.knex, paymentId);
    if (!found) throw new NotFoundError("Payment not found");

    await this.knex.transaction(async (trx) => {
      const order = await this.orders.findByIdForUpdate(trx, found.order_id); // order first (see LOCK ORDER)
      const payment = await this.payments.findByIdForUpdate(trx, paymentId);
      if (!order || !payment) throw new NotFoundError("Payment not found");
      if (payment.refund_status === "refunded")
        throw new ConflictError("This payment was already refunded");
      if (payment.refund_status !== "pending")
        throw new ConflictError("This payment does not need a refund");

      await this.payments.markRefunded(trx, payment.id, actorId);
      await this.orders.addHistory(trx, {
        order_id: order.id,
        from_status: order.order_status,
        to_status: order.order_status,
        note: `Refund of ${payment.txn_ref} completed`,
        changed_by: actorId,
      });
      // a cancelled order is "refunded" once its LAST pending refund is paid back; a duplicate leaves the order alone
      if (
        order.payment_status === "refund_pending" &&
        (await this.payments.countPendingRefunds(trx, order.id)) === 0
      ) {
        await this.orders.update(trx, order.id, { payment_status: "refunded" });
      }
    });
    return (await this.payments.findRefund(this.knex, paymentId))!;
  }

  /** Admin shortcut for a CANCELLED order: everything that was paid for it is back with the customer. */
  async refundOrder(orderId: number, actorId: number): Promise<void> {
    await this.knex.transaction(async (trx) => {
      const order = await this.orders.findByIdForUpdate(trx, orderId);
      if (!order) throw new NotFoundError("Order not found");
      if (order.payment_status !== "refund_pending")
        throw new ConflictError("This order has no pending refund");

      await this.payments.markOrderRefunded(trx, order.id, actorId);
      await this.orders.update(trx, order.id, { payment_status: "refunded" });
      await this.orders.addHistory(trx, {
        order_id: order.id,
        from_status: order.order_status,
        to_status: order.order_status,
        note: "Refund completed",
        changed_by: actorId,
      });
    });
  }

  // ---------------------------------------------------------------- internals

  private async applySuccess(
    trx: Knex.Transaction,
    payment: PaymentRow,
    paidAt: Date,
  ): Promise<void> {
    const order = await this.orders.findByIdForUpdate(trx, payment.order_id);
    if (!order) return;
    const note = (text: string) =>
      this.orders.addHistory(trx, {
        order_id: order.id,
        from_status: order.order_status,
        to_status: order.order_status,
        note: text,
      });

    // Money arrived that the order cannot use. One rule for both cases: flag THIS PAYMENT for refund
    // (the queue is per payment) and never touch the order's fulfilment state.
    if (order.order_status === "cancelled") {
      await this.payments.update(trx, payment.id, {
        refund_status: "pending",
        refund_reason: "Paid after the order was cancelled",
      });
      await this.orders.update(trx, order.id, {
        payment_status: "refund_pending",
        paid_at: order.paid_at ?? paidAt,
      });
      return note(
        `Payment ${payment.txn_ref} received after cancellation; refund required`,
      );
    }
    if (order.payment_status !== "unpaid") {
      // The order stays "paid" and keeps moving: the FIRST payment is valid. Only the extra one goes back.
      await this.payments.update(trx, payment.id, {
        refund_status: "pending",
        refund_reason: "Duplicate payment: the order was already paid",
      });
      return note(
        `Duplicate payment ${payment.txn_ref} received; refund required`,
      );
    }

    const confirm = order.order_status === "pending";
    await this.orders.update(trx, order.id, {
      payment_status: "paid",
      paid_at: paidAt,
      ...(confirm ? { order_status: "confirmed" as const } : {}),
    });
    await this.orders.addHistory(trx, {
      order_id: order.id,
      from_status: order.order_status,
      to_status: confirm ? "confirmed" : order.order_status,
      note: `Paid via VNPay (${payment.txn_ref})`,
    });

    const user = await this.users.findById(order.user_id, trx);
    if (user) {
      await this.mail.enqueue(trx, {
        type: "payment_success",
        to: user.email,
        data: {
          fullName: user.full_name,
          orderCode: order.order_code,
          amount: payment.amount,
        },
      });
    }
  }
}

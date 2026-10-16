import type { FastifyReply, FastifyRequest } from "fastify";
import type { IdParams } from "../../common/schemas/common.js";
import { buildMeta } from "../../common/utils/pagination.js";
import { ok, paginated } from "../../common/utils/response.js";
import { currentUser } from "../../plugins/auth.js";
import type { ListRefundsQuery, RefundDto } from "./payments.schema.js";
import type { PaymentsService } from "./payments.service.js";
import type { RefundRow } from "./payments.types.js";

const toRefundDto = (r: RefundRow): RefundDto => ({
  paymentId: r.id,
  txnRef: r.txn_ref,
  providerTxnNo: r.provider_txn_no,
  bankCode: r.bank_code,
  amount: r.amount,
  paidAt: r.paid_at?.toISOString() ?? null,
  refundStatus: r.refund_status as "pending" | "refunded", // the queries never return "none"
  refundReason: r.refund_reason,
  refundedAt: r.refunded_at?.toISOString() ?? null,
  refundedBy: r.refunded_by,
  order: {
    id: r.order_id,
    orderCode: r.order_code,
    orderStatus: r.order_status,
    paymentStatus: r.order_payment_status,
  },
});

export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  ipn = async (request: FastifyRequest) =>
    this.service.handleIpn(request.query as Record<string, unknown>);

  returnUrl = async (request: FastifyRequest, reply: FastifyReply) =>
    reply.redirect(
      await this.service.resultRedirectUrl(
        request.query as Record<string, unknown>,
      ),
    );

  listRefunds = async (
    request: FastifyRequest<{ Querystring: ListRefundsQuery }>,
  ) => {
    const { status = "pending", page, perPage } = request.query;
    const { items, total } = await this.service.listRefunds(
      status,
      page,
      perPage,
    );
    return paginated(items.map(toRefundDto), buildMeta(page, perPage, total));
  };

  markRefunded = async (request: FastifyRequest<{ Params: IdParams }>) =>
    ok(
      toRefundDto(
        await this.service.recordRefund(
          request.params.id,
          currentUser(request).id,
        ),
      ),
      "Refund recorded",
    );
}

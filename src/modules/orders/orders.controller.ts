import type { FastifyReply, FastifyRequest } from "fastify";
import type { IdParams } from "../../common/schemas/common.js";
import { buildMeta } from "../../common/utils/pagination.js";
import { ok, paginated } from "../../common/utils/response.js";
import { currentUser } from "../../plugins/auth.js";
import type { PaymentLink } from "../payments/payments.service.js";
import type {
  BuyNowBody,
  CancelBody,
  CheckoutBody,
  ListOrdersQuery,
  UpdateOrderStatusBody,
} from "./orders.schema.js";
import { toOrderDto } from "./orders.serializer.js";
import type { CheckoutResult, OrdersService } from "./orders.service.js";

const toPaymentDto = (p: PaymentLink) => ({
  paymentUrl: p.paymentUrl,
  txnRef: p.txnRef,
  expiresAt: p.expiresAt.toISOString(),
});

const toCheckoutDto = (r: CheckoutResult) => ({
  order: toOrderDto(r.order),
  payment: r.payment ? toPaymentDto(r.payment) : null,
});

export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  checkout = async (
    request: FastifyRequest<{ Body: CheckoutBody }>,
    reply: FastifyReply,
  ) => {
    const result = await this.service.checkout(
      currentUser(request),
      request.body,
      request.ip,
    );
    reply.code(201);
    return ok(toCheckoutDto(result), "Order placed");
  };

  buyNow = async (
    request: FastifyRequest<{ Body: BuyNowBody }>,
    reply: FastifyReply,
  ) => {
    const result = await this.service.buyNow(
      currentUser(request),
      request.body,
      request.ip,
    );
    reply.code(201);
    return ok(toCheckoutDto(result), "Order placed");
  };

  list = async (request: FastifyRequest<{ Querystring: ListOrdersQuery }>) => {
    const { items, total } = await this.service.list(
      currentUser(request),
      request.query,
    );
    return paginated(
      items.map(toOrderDto),
      buildMeta(request.query.page, request.query.perPage, total),
    );
  };

  get = async (request: FastifyRequest<{ Params: IdParams }>) =>
    ok(
      toOrderDto(
        await this.service.get(request.params.id, currentUser(request)),
      ),
    );

  cancel = async (
    request: FastifyRequest<{ Params: IdParams; Body: CancelBody }>,
  ) =>
    ok(
      toOrderDto(
        await this.service.cancel(
          request.params.id,
          currentUser(request),
          request.body.reason,
        ),
      ),
      "Order cancelled",
    );

  updateStatus = async (
    request: FastifyRequest<{ Params: IdParams; Body: UpdateOrderStatusBody }>,
  ) =>
    ok(
      toOrderDto(
        await this.service.updateStatus(
          request.params.id,
          request.body.status,
          currentUser(request),
        ),
      ),
      "Order updated",
    );

  markRefunded = async (request: FastifyRequest<{ Params: IdParams }>) =>
    ok(
      toOrderDto(
        await this.service.markRefunded(
          request.params.id,
          currentUser(request),
        ),
      ),
      "Refund recorded",
    );

  pay = async (request: FastifyRequest<{ Params: IdParams }>) =>
    ok(
      toPaymentDto(
        await this.service.createPaymentLink(
          request.params.id,
          currentUser(request),
          request.ip,
        ),
      ),
      "Payment link created",
    );
}

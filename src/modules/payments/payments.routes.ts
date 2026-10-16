import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
  ErrorResponse,
  IdParams,
  bearerSecurity,
  paginatedOf,
  securedErrors,
  successOf,
} from "../../common/schemas/common.js";
import { PaymentsController } from "./payments.controller.js";
import { ListRefundsQuery, RefundSchema } from "./payments.schema.js";

const IpnResponse = Type.Object({
  RspCode: Type.String(),
  Message: Type.String(),
});

/**
 * Registered under /api/payments. The two VNPay callbacks are public: authenticity comes from VNPay's HMAC signature.
 * No querystring schema on them on purpose: the signature must be checked over the RAW parameters.
 */
const paymentsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = new PaymentsController(app.services.payments);
  const tags = ["Payments"];
  const security = bearerSecurity;
  const admin = [app.authenticate, app.authorize("admin")];

  app.get(
    "/vnpay/ipn",
    {
      schema: {
        tags,
        summary:
          "VNPay IPN (server to server). Register this URL in the VNPay merchant portal.",
        description:
          "Query = the signed vnp_* parameters. Always answers HTTP 200 with { RspCode, Message }.",
        response: { 200: IpnResponse },
      },
    },
    controller.ipn,
  );

  app.get(
    "/vnpay/return",
    {
      schema: {
        tags,
        summary:
          "Browser return from VNPay: verifies the signature, then redirects to the frontend result page",
        description:
          "Changes nothing. The order is marked paid by the IPN only.",
      },
    },
    controller.returnUrl,
  );

  app.get(
    "/refunds",
    {
      preHandler: admin,
      schema: {
        tags,
        summary: "Refund queue (admin): payments whose money must be paid back",
        description:
          "Default `status=pending`, oldest first. A payment lands here when it was a duplicate, arrived after its order was cancelled, or belonged to an order cancelled after payment.",
        security,
        querystring: ListRefundsQuery,
        response: { 200: paginatedOf(RefundSchema), ...securedErrors },
      },
    },
    controller.listRefunds,
  );

  app.post(
    "/:id/refunded",
    {
      preHandler: admin,
      schema: {
        tags,
        summary:
          "Record that ONE payment was paid back in the VNPay portal (admin). Send no body.",
        security,
        params: IdParams,
        response: {
          200: successOf(RefundSchema),
          404: ErrorResponse,
          409: ErrorResponse,
          ...securedErrors,
        },
      },
    },
    controller.markRefunded,
  );
};

export default paymentsRoutes;

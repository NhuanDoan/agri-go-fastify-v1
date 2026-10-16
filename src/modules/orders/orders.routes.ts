import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
  ErrorResponse,
  IdParams,
  bearerSecurity,
  paginatedOf,
  securedErrors,
  successOf,
} from "../../common/schemas/common.js";
import { OrdersController } from "./orders.controller.js";
import {
  BuyNowBody,
  CancelBody,
  CheckoutBody,
  CheckoutResultSchema,
  ListOrdersQuery,
  OrderSchema,
  PaymentLinkSchema,
  UpdateOrderStatusBody,
} from "./orders.schema.js";

/** Registered under /api/orders. */
const ordersRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = new OrdersController(app.services.orders);
  const tags = ["Orders"];
  const security = bearerSecurity;
  const auth = [app.authenticate];
  const admin = [app.authenticate, app.authorize("admin")];
  const single = {
    200: successOf(OrderSchema),
    404: ErrorResponse,
    409: ErrorResponse,
    ...securedErrors,
  };

  app.post(
    "/checkout",
    {
      preHandler: auth,
      schema: {
        tags,
        summary: "Place an order from the cart",
        description:
          "One transaction: stock is locked and reserved, the cart is emptied, a confirmation mail is queued. For `vnpay` the response carries `payment.paymentUrl`: redirect the browser there. The order is marked paid by the VNPay IPN, never by the browser return.",
        security,
        body: CheckoutBody,
        response: {
          201: successOf(CheckoutResultSchema),
          503: ErrorResponse,
          ...securedErrors,
        },
      },
    },
    controller.checkout,
  );

  app.post(
    "/buy-now",
    {
      preHandler: auth,
      schema: {
        tags,
        summary: "Order one product directly (the cart is untouched)",
        security,
        body: BuyNowBody,
        response: {
          201: successOf(CheckoutResultSchema),
          503: ErrorResponse,
          ...securedErrors,
        },
      },
    },
    controller.buyNow,
  );

  app.get(
    "/",
    {
      prefixTrailingSlash: "no-slash",
      preHandler: auth,
      schema: {
        tags,
        summary: "My orders (admins see all orders)",
        security,
        querystring: ListOrdersQuery,
        response: { 200: paginatedOf(OrderSchema), ...securedErrors },
      },
    },
    controller.list,
  );

  app.get(
    "/:id",
    {
      preHandler: auth,
      schema: {
        tags,
        summary: "Order detail",
        security,
        params: IdParams,
        response: single,
      },
    },
    controller.get,
  );

  app.post(
    "/:id/cancel",
    {
      preHandler: auth,
      schema: {
        tags,
        summary:
          "Cancel and restock (customers: pending orders only). Send {} as the body.",
        security,
        params: IdParams,
        body: CancelBody,
        response: single,
      },
    },
    controller.cancel,
  );

  app.patch(
    "/:id/status",
    {
      preHandler: admin,
      schema: {
        tags,
        summary:
          "Move an order along (admin): pending > confirmed > shipping > completed, or cancelled",
        security,
        params: IdParams,
        body: UpdateOrderStatusBody,
        response: single,
      },
    },
    controller.updateStatus,
  );
  app.post(
    "/:id/payment",
    {
      preHandler: auth,
      schema: {
        tags,
        summary: "New VNPay payment link for my unpaid order",
        security,
        params: IdParams,
        response: {
          200: successOf(PaymentLinkSchema),
          404: ErrorResponse,
          409: ErrorResponse,
          503: ErrorResponse,
          ...securedErrors,
        },
      },
    },
    controller.pay,
  );

  app.post(
    "/:id/refunded",
    {
      preHandler: admin,
      schema: {
        tags,
        summary: "Record that a pending refund was paid out (admin)",
        security,
        params: IdParams,
        response: single,
      },
    },
    controller.markRefunded,
  );
};

export default ordersRoutes;

import { Type, type Static } from "@sinclair/typebox";
import {
  Nullable,
  PaginationQuery,
  PhoneSchema,
  StringEnum,
} from "../../common/schemas/common.js";
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from "./orders.types.js";

export const OrderItemSchema = Type.Object({
  productId: Type.Integer(),
  productName: Type.String(),
  unit: Type.String(),
  quantity: Type.Integer(),
  price: Type.Integer(),
  subtotal: Type.Integer(),
});

export const OrderSchema = Type.Object({
  id: Type.Integer(),
  orderCode: Type.String(),
  orderStatus: StringEnum(ORDER_STATUSES),
  paymentMethod: StringEnum(PAYMENT_METHODS),
  paymentStatus: StringEnum(PAYMENT_STATUSES),
  subtotal: Type.Integer(),
  shippingFee: Type.Integer(),
  totalPrice: Type.Integer(),
  receiver: Type.Object({
    name: Type.String(),
    phone: Type.String(),
    address: Type.String(),
  }),
  note: Nullable(Type.String()),
  paidAt: Nullable(Type.String()),
  cancelledAt: Nullable(Type.String()),
  cancelReason: Nullable(Type.String()),
  createdAt: Type.String(),
  items: Type.Array(OrderItemSchema),
});
export type OrderDto = Static<typeof OrderSchema>;

const ShippingInput = Type.Optional(
  Type.Object(
    {
      receiverName: Type.Optional(
        Type.String({ minLength: 1, maxLength: 100 }),
      ),
      phone: Type.Optional(PhoneSchema),
      address: Type.Optional(Type.String({ minLength: 5, maxLength: 500 })),
    },
    { additionalProperties: false },
  ),
);

export const CheckoutBody = Type.Object(
  {
    paymentMethod: StringEnum(PAYMENT_METHODS),
    shipping: ShippingInput, // omitted fields fall back to the profile's name / phone / address
    note: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);
export type CheckoutBody = Static<typeof CheckoutBody>;

export const BuyNowBody = Type.Object(
  {
    productId: Type.Integer({ minimum: 1 }),
    quantity: Type.Integer({ minimum: 1, maximum: 1000 }),
    paymentMethod: StringEnum(PAYMENT_METHODS),
    shipping: ShippingInput,
    note: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);
export type BuyNowBody = Static<typeof BuyNowBody>;

export const CancelBody = Type.Object(
  { reason: Type.Optional(Type.String({ maxLength: 255 })) },
  { additionalProperties: false },
);
export type CancelBody = Static<typeof CancelBody>;

export const UpdateOrderStatusBody = Type.Object(
  { status: StringEnum(ORDER_STATUSES) },
  { additionalProperties: false },
);
export type UpdateOrderStatusBody = Static<typeof UpdateOrderStatusBody>;

export const ListOrdersQuery = Type.Composite([
  PaginationQuery,
  Type.Object({
    orderStatus: Type.Optional(StringEnum(ORDER_STATUSES)),
    paymentStatus: Type.Optional(StringEnum(PAYMENT_STATUSES)),
    userId: Type.Optional(Type.Integer({ minimum: 1 })), // honoured for admins only
  }),
]);
export type ListOrdersQuery = Static<typeof ListOrdersQuery>;

export const PaymentLinkSchema = Type.Object({
  paymentUrl: Type.String(),
  txnRef: Type.String(),
  expiresAt: Type.String(),
});

/** `payment` is set for VNPay orders: redirect the customer's browser to payment.paymentUrl. */
export const CheckoutResultSchema = Type.Object({
  order: OrderSchema,
  payment: Nullable(PaymentLinkSchema),
});

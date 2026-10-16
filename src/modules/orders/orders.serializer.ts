import type { OrderDto } from "./orders.schema.js";
import type { OrderView } from "./orders.types.js";

export const toOrderDto = (o: OrderView): OrderDto => ({
  id: o.id,
  orderCode: o.order_code,
  orderStatus: o.order_status,
  paymentMethod: o.payment_method,
  paymentStatus: o.payment_status,
  subtotal: o.subtotal,
  shippingFee: o.shipping_fee,
  totalPrice: o.total_price,
  receiver: {
    name: o.receiver_name,
    phone: o.receiver_phone,
    address: o.shipping_address,
  },
  note: o.note,
  paidAt: o.paid_at?.toISOString() ?? null,
  cancelledAt: o.cancelled_at?.toISOString() ?? null,
  cancelReason: o.cancel_reason,
  createdAt: o.created_at.toISOString(),
  items: o.items.map((i) => ({
    productId: i.product_id,
    productName: i.product_name,
    unit: i.unit,
    quantity: i.quantity,
    price: i.price,
    subtotal: i.subtotal,
  })),
});

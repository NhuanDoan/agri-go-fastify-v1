export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "shipping",
  "completed",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
  "unpaid",
  "paid",
  "refund_pending",
  "refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ["cod", "vnpay"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface OrderRow {
  id: number;
  order_code: string;
  user_id: number;
  subtotal: number;
  shipping_fee: number;
  total_price: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  order_status: OrderStatus;
  receiver_name: string;
  receiver_phone: string;
  shipping_address: string;
  note: string | null;
  paid_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface OrderDetailRow {
  id: number;
  order_id: number;
  product_id: number;
  product_name: string;
  unit: string;
  quantity: number;
  price: number;
  subtotal: number;
}

export interface OrderView extends OrderRow {
  items: OrderDetailRow[];
}

export interface OrderFilter {
  page: number;
  perPage: number;
  userId?: number;
  orderStatus?: OrderStatus;
  paymentStatus?: PaymentStatus;
}

/** A product row held under FOR UPDATE during checkout. */
export interface ProductLock {
  id: number;
  name: string;
  unit: string;
  price: number;
  quantity: number;
  status: "active" | "inactive";
}

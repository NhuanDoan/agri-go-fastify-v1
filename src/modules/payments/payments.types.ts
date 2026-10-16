export interface PaymentRow {
  id: number;
  order_id: number;
  provider: "vnpay";
  txn_ref: string;
  amount: number;
  status: "pending" | "success" | "failed";
  provider_txn_no: string | null;
  bank_code: string | null;
  response_code: string | null;
  paid_at: Date | null;
  raw_payload: unknown;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
  refund_status: "none" | "pending" | "refunded";
  refund_reason: string | null;
  refunded_at: Date | null;
  refunded_by: number | null;
}

/** A payment plus the order it belongs to: what the refund queue shows. */
export interface RefundRow extends PaymentRow {
  order_code: string;
  order_status:
    | "pending"
    | "confirmed"
    | "shipping"
    | "completed"
    | "cancelled";
  order_payment_status: "unpaid" | "paid" | "refund_pending" | "refunded";
}

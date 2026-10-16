export interface OtpMailData {
  fullName: string;
  code: string;
  ttlMinutes: number;
}

/** Everything the system can send. `type` is the template key and the mail_outbox.type column. Grows each step. */
export type OutgoingMail =
  | { type: "email_verification"; to: string; data: OtpMailData }
  | { type: "password_reset"; to: string; data: OtpMailData }
  | { type: "order_placed"; to: string; data: OrderPlacedData }
  | { type: "payment_success"; to: string; data: PaymentSuccessData };

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

export interface MailMessage extends RenderedMail {
  to: string;
}

export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

export interface MailOutboxRow {
  id: number;
  type: OutgoingMail["type"];
  to_email: string;
  payload: unknown;
  status: "pending" | "sent" | "failed";
  attempts: number;
  next_attempt_at: Date;
  last_error: string | null;
  sent_at: Date | null;
  locked_until: Date | null;
  lock_token: string | null;
}

export interface OrderPlacedData {
  fullName: string;
  orderCode: string;
  paymentMethod: "cod" | "vnpay";
  shippingAddress: string;
  items: { name: string; quantity: number; unit: string; price: number }[];
  total: number;
}

export interface PaymentSuccessData {
  fullName: string;
  orderCode: string;
  amount: number;
}

import type { Knex } from "knex";
import { randomBytes } from "node:crypto";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  UnprocessableError,
} from "../../common/errors/app-error.js";
import type { AuthUser } from "../../common/security/token.service.js";
import type { Paged } from "../../common/utils/pagination.js";
import type { CartsRepository } from "../carts/carts.repository.js";
import type { InventoryRepository } from "../inventory/inventory.repository.js";
import type { MailService } from "../mail/mail.service.js";
import type {
  PaymentLink,
  PaymentsService,
} from "../payments/payments.service.js";
import type { UsersRepository } from "../users/users.repository.js";
import type { UserRow } from "../users/users.types.js";
import type { OrdersRepository } from "./orders.repository.js";
import type {
  BuyNowBody,
  CheckoutBody,
  ListOrdersQuery,
} from "./orders.schema.js";
import type {
  OrderRow,
  OrderStatus,
  OrderView,
  PaymentMethod,
} from "./orders.types.js";

export interface CheckoutResult {
  order: OrderView;
  payment: PaymentLink | null;
}

interface Shipping {
  receiverName: string;
  phone: string;
  address: string;
}

/** Legal manual status changes. Cancelling additionally restocks. */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["shipping", "cancelled"],
  shipping: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/** AG250131 + 8 hex chars. Alphanumeric only, so it is safe to hand to a payment gateway. */
const newOrderCode = (): string => {
  const day = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  return `AG${day}${randomBytes(5).toString("hex").toUpperCase().slice(0, 8)}`;
};

export class OrdersService {
  constructor(
    private readonly knex: Knex,
    private readonly orders: OrdersRepository,
    private readonly carts: CartsRepository,
    private readonly inventory: InventoryRepository,
    private readonly users: UsersRepository,
    private readonly mail: MailService,
    private readonly payments: PaymentsService, // NEW
    private readonly cfg: { shippingFee: number; unpaidGraceMinutes: number }, // NEW field
  ) {}

  // ------------------------------------------------------------------ placing orders

  async checkout(
    actor: AuthUser,
    input: CheckoutBody,
    ip: string,
  ): Promise<CheckoutResult> {
    const user = await this.requireVerifiedBuyer(actor.id);
    this.assertPayable(input.paymentMethod);
    const shipping = this.resolveShipping(input.shipping, user);

    const order = await this.knex.transaction(async (trx) => {
      const cart = await this.carts.getOrCreate(trx, user.id);
      await this.carts.lock(trx, cart.id); // two simultaneous checkouts of one cart queue here
      const lines = await this.carts.lines(trx, cart.id);
      if (lines.length === 0)
        throw new UnprocessableError("Your cart is empty");

      const placed = await this.place(
        trx,
        user,
        lines.map((l) => ({ productId: l.product_id, quantity: l.quantity })),
        shipping,
        input.paymentMethod,
        input.note ?? null,
      );
      await this.carts.clear(trx, cart.id);
      return placed;
    });
    return this.finish(order, ip);
  }

  /** Order one product directly; the cart is left alone. */
  async buyNow(
    actor: AuthUser,
    input: BuyNowBody,
    ip: string,
  ): Promise<CheckoutResult> {
    const user = await this.requireVerifiedBuyer(actor.id);
    this.assertPayable(input.paymentMethod);
    const shipping = this.resolveShipping(input.shipping, user);
    const order = await this.knex.transaction((trx) =>
      this.place(
        trx,
        user,
        [{ productId: input.productId, quantity: input.quantity }],
        shipping,
        input.paymentMethod,
        input.note ?? null,
      ),
    );
    return this.finish(order, ip);
  }

  /** NEW: another VNPay attempt for an unpaid order (the first link expired, or the customer walked away). */
  async createPaymentLink(
    orderId: number,
    actor: AuthUser,
    ip: string,
  ): Promise<PaymentLink> {
    const order = await this.orders.findById(this.knex, orderId);
    if (!order || order.user_id !== actor.id)
      throw new NotFoundError("Order not found");
    return this.payments.createVnpayPayment(orderId, ip);
  }

  // ------------------------------------------------------------------ reading

  async list(actor: AuthUser, q: ListOrdersQuery): Promise<Paged<OrderView>> {
    const isAdmin = actor.role === "admin";
    const { items, total } = await this.orders.list(this.knex, {
      page: q.page,
      perPage: q.perPage,
      orderStatus: q.orderStatus,
      paymentStatus: q.paymentStatus,
      userId: isAdmin ? q.userId : actor.id, // customers can never widen this
    });
    return { items: await this.withItems(items), total };
  }

  async get(id: number, actor: AuthUser): Promise<OrderView> {
    const order = await this.orders.findById(this.knex, id);
    // 404, not 403, for other people's orders: don't confirm that the id exists
    if (!order || (actor.role !== "admin" && order.user_id !== actor.id))
      throw new NotFoundError("Order not found");
    return (await this.withItems([order]))[0]!;
  }

  // ------------------------------------------------------------------ changing orders

  async cancel(
    id: number,
    actor: AuthUser,
    reason?: string,
  ): Promise<OrderView> {
    await this.knex.transaction(async (trx) => {
      const order = await this.orders.findByIdForUpdate(trx, id);
      if (!order || (actor.role !== "admin" && order.user_id !== actor.id))
        throw new NotFoundError("Order not found");
      if (!TRANSITIONS[order.order_status].includes("cancelled")) {
        throw new ConflictError(
          `A ${order.order_status} order cannot be cancelled`,
        );
      }
      if (
        actor.role !== "admin" &&
        (order.order_status !== "pending" || order.payment_status !== "unpaid")
      ) {
        throw new ConflictError(
          "Only unpaid, pending orders can be cancelled by the customer; contact support",
        );
      }
      const why =
        reason ??
        (actor.role === "admin"
          ? "Cancelled by admin"
          : "Cancelled by customer");
      await this.cancelInTx(trx, order, why, actor.id);
    });
    return this.get(id, actor);
  }

  async updateStatus(
    id: number,
    to: OrderStatus,
    actor: AuthUser,
  ): Promise<OrderView> {
    await this.knex.transaction(async (trx) => {
      const order = await this.orders.findByIdForUpdate(trx, id);
      if (!order) throw new NotFoundError("Order not found");
      if (!TRANSITIONS[order.order_status].includes(to)) {
        throw new ConflictError(
          `Cannot change an order from ${order.order_status} to ${to}`,
        );
      }
      if (to === "cancelled")
        return this.cancelInTx(trx, order, "Cancelled by admin", actor.id);

      // NEW: never ship goods that an online payment has not covered
      if (order.payment_method === "vnpay" && order.payment_status !== "paid") {
        throw new UnprocessableError(
          "A VNPay order must be paid before it can progress",
        );
      }
      const patch: Partial<OrderRow> = { order_status: to };
      if (to === "completed" && order.payment_status === "unpaid") {
        patch.payment_status = "paid"; // cash collected on delivery
        patch.paid_at = new Date();
      }
      await this.orders.update(trx, id, patch);
      await this.orders.addHistory(trx, {
        order_id: id,
        from_status: order.order_status,
        to_status: to,
        changed_by: actor.id,
      });
    });
    return this.get(id, actor);
  }

  /** Admin shortcut for a CANCELLED order: closes every pending refund of it (see PaymentsService.refundOrder). */
  async markRefunded(id: number, actor: AuthUser): Promise<OrderView> {
    await this.payments.refundOrder(id, actor.id);
    return this.get(id, actor);
  }

  /** NEW, run by a job: cancel VNPay orders nobody paid, returning the reserved stock. */
  async cancelExpiredUnpaid(): Promise<number> {
    const cutoff = new Date(Date.now() - this.cfg.unpaidGraceMinutes * 60_000);
    const ids = await this.orders.findExpiredUnpaidIds(this.knex, cutoff, 50);
    let cancelled = 0;
    for (const id of ids) {
      await this.knex.transaction(async (trx) => {
        const order = await this.orders.findByIdForUpdate(trx, id);
        // re-check under the row lock: an IPN may have marked it paid a moment ago
        if (
          !order ||
          order.order_status !== "pending" ||
          order.payment_status !== "unpaid"
        )
          return;
        await this.cancelInTx(trx, order, "Payment timeout", null);
        cancelled++;
      });
    }
    return cancelled;
  }

  // ------------------------------------------------------------------ internals

  /** Lock products (id order) -> validate -> order + snapshot lines -> stock + ledger -> history -> mail, in ONE transaction. */
  private async place(
    trx: Knex.Transaction,
    user: UserRow,
    lines: { productId: number; quantity: number }[],
    shipping: Shipping,
    method: PaymentMethod,
    note: string | null,
  ): Promise<OrderRow> {
    const wanted = new Map<number, number>();
    for (const l of lines)
      wanted.set(l.productId, (wanted.get(l.productId) ?? 0) + l.quantity);
    const ids = [...wanted.keys()].sort((a, b) => a - b);

    const locked = new Map(
      (await this.orders.lockProducts(trx, ids)).map((p) => [p.id, p]),
    );

    const problems: { productId: number; message: string }[] = [];
    for (const id of ids) {
      const p = locked.get(id);
      const qty = wanted.get(id)!;
      if (!p || p.status !== "active")
        problems.push({
          productId: id,
          message: "Product is no longer available",
        });
      else if (p.quantity < qty)
        problems.push({
          productId: id,
          message: `Only ${p.quantity} ${p.unit} left in stock`,
        });
    }
    if (problems.length > 0)
      throw new UnprocessableError("Some items cannot be ordered", problems);

    const subtotal = ids.reduce(
      (sum, id) => sum + locked.get(id)!.price * wanted.get(id)!,
      0,
    );
    const orderId = await this.orders.insert(trx, {
      order_code: newOrderCode(),
      user_id: user.id,
      subtotal,
      shipping_fee: this.cfg.shippingFee,
      total_price: subtotal + this.cfg.shippingFee,
      payment_method: method,
      receiver_name: shipping.receiverName,
      receiver_phone: shipping.phone,
      shipping_address: shipping.address,
      note,
    });

    await this.orders.insertDetails(
      trx,
      ids.map((id) => {
        const p = locked.get(id)!;
        return {
          order_id: orderId,
          product_id: id,
          product_name: p.name,
          unit: p.unit,
          quantity: wanted.get(id)!,
          price: p.price,
        };
      }),
    );

    for (const id of ids) {
      const qty = wanted.get(id)!;
      const after = await this.orders.adjustStock(trx, id, -qty);
      await this.inventory.record(trx, {
        productId: id,
        delta: -qty,
        quantityAfter: after,
        reason: "order_placed",
        orderId,
        createdBy: user.id,
      });
    }

    await this.orders.addHistory(trx, {
      order_id: orderId,
      from_status: null,
      to_status: "pending",
      note: "Order placed",
      changed_by: user.id,
    });

    const order = (await this.orders.findById(trx, orderId))!;
    await this.mail.enqueue(trx, {
      type: "order_placed",
      to: user.email,
      data: {
        fullName: user.full_name,
        orderCode: order.order_code,
        paymentMethod: method,
        shippingAddress: shipping.address,
        items: ids.map((id) => {
          const p = locked.get(id)!;
          return {
            name: p.name,
            quantity: wanted.get(id)!,
            unit: p.unit,
            price: p.price,
          };
        }),
        total: order.total_price,
      },
    });
    return order;
  }

  /**
   * Restock, then mark cancelled. A paid order becomes refund_pending (the money goes back by hand).
   * Pending payment attempts are deliberately left pending: if the customer still pays through an old link,
   * the IPN must record that money and flag a refund rather than answer "already processed".
   */
  private async cancelInTx(
    trx: Knex.Transaction,
    order: OrderRow,
    reason: string,
    actorId: number | null,
  ): Promise<void> {
    const details = (await this.orders.details(trx, [order.id])).sort(
      (a, b) => a.product_id - b.product_id,
    );
    await this.orders.lockProductsIncludingDeleted(
      trx,
      details.map((d) => d.product_id),
    );

    for (const d of details) {
      const after = await this.orders.adjustStock(
        trx,
        d.product_id,
        d.quantity,
      );
      await this.inventory.record(trx, {
        productId: d.product_id,
        delta: d.quantity,
        quantityAfter: after,
        reason: "order_cancelled",
        orderId: order.id,
        createdBy: actorId,
      });
    }

    await this.orders.update(trx, order.id, {
      order_status: "cancelled",
      cancelled_at: new Date(),
      cancel_reason: reason,
      payment_status:
        order.payment_status === "paid"
          ? "refund_pending"
          : order.payment_status,
    });
    await this.orders.addHistory(trx, {
      order_id: order.id,
      from_status: order.order_status,
      to_status: "cancelled",
      note: reason,
      changed_by: actorId,
    });
    // order-level: "this order's money must go back". Payment-level: WHICH payments. The refund queue reads the latter.
    if (order.payment_status === "paid") {
      await this.payments.flagRefundForOrder(
        trx,
        order.id,
        "Order cancelled after payment",
      );
    }
  }

  /**
   * After COMMIT on purpose. If the gateway step fails, the order still exists and the customer can retry with
   * POST /orders/:id/payment; if they never do, the expiry job returns the stock.
   */
  private async finish(order: OrderRow, ip: string): Promise<CheckoutResult> {
    const payment =
      order.payment_method === "vnpay"
        ? await this.payments.createVnpayPayment(order.id, ip)
        : null;
    return { order: (await this.withItems([order]))[0]!, payment };
  }

  private async withItems(orders: OrderRow[]): Promise<OrderView[]> {
    const details = await this.orders.details(
      this.knex,
      orders.map((o) => o.id),
    );
    return orders.map((o) => ({
      ...o,
      items: details.filter((d) => d.order_id === o.id),
    }));
  }

  private assertPayable(method: PaymentMethod): void {
    if (method === "vnpay") this.payments.assertVnpayConfigured(); // fail BEFORE any stock is reserved
  }

  /**
   * Active AND verified. Order and payment mails must reach a real mailbox. Read from the database on every
   * order, not from the token: verifying takes effect at once, and un-verifying (an admin changing the email) too.
   */
  private async requireVerifiedBuyer(id: number): Promise<UserRow> {
    const user = await this.users.findById(id);
    if (!user || user.status !== "active") throw new UnauthorizedError();
    if (!user.email_verified_at) {
      throw new ForbiddenError(
        "Verify your email address before placing an order",
        "EMAIL_NOT_VERIFIED",
      );
    }
    return user;
  }

  /** Inline shipping fields win; missing ones fall back to the profile. */
  private resolveShipping(
    input: CheckoutBody["shipping"],
    user: UserRow,
  ): Shipping {
    const phone = input?.phone ?? user.phone;
    const address = input?.address ?? user.address;
    const missing = [
      ...(phone
        ? []
        : [{ field: "shipping.phone", message: "Phone is required" }]),
      ...(address
        ? []
        : [{ field: "shipping.address", message: "Address is required" }]),
    ];
    if (missing.length > 0)
      throw new UnprocessableError("Shipping details are incomplete", missing);
    return {
      receiverName: input?.receiverName ?? user.full_name,
      phone: phone!,
      address: address!,
    };
  }
}

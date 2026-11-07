import type { CartDto } from "./carts.schema.js";
import type { CartLineRow } from "./carts.types.js";

export function toCartDto(cartId: number, rows: CartLineRow[]): CartDto {
  const items = rows.map((r) => ({
    productId: r.product_id,
    name: r.name,
    imageUrl: r.image_url,
    discountPercent: r.discount_percent,
    averageRating:
      r.average_rating === null ? null : Number(r.average_rating),
    soldCount: Number(r.sold_count),
    unit: r.unit,
    price: r.price, // the CURRENT price: a cart is not a price promise, the order is
    quantity: r.quantity,
    subtotal: r.price * r.quantity,
    stock: r.stock,
    available:
      r.status === "active" && r.deleted_at === null && r.stock >= r.quantity,
  }));
  return {
    id: cartId,
    items,
    totalItems: items.reduce((n, i) => n + i.quantity, 0),
    subtotal: items
      .filter((i) => i.available)
      .reduce((n, i) => n + i.subtotal, 0),
  };
}

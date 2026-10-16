import { Type, type Static } from "@sinclair/typebox";

export const CartItemSchema = Type.Object({
  productId: Type.Integer(),
  name: Type.String(),
  unit: Type.String(),
  price: Type.Integer(),
  quantity: Type.Integer(),
  subtotal: Type.Integer(),
  stock: Type.Integer(),
  /** false when the product was deactivated, deleted, or no longer has enough stock: checkout would refuse it. */
  available: Type.Boolean(),
});

export const CartSchema = Type.Object({
  id: Type.Integer(),
  items: Type.Array(CartItemSchema),
  totalItems: Type.Integer(),
  subtotal: Type.Integer(), // counts available items only
});
export type CartDto = Static<typeof CartSchema>;

export const AddCartItemBody = Type.Object(
  {
    productId: Type.Integer({ minimum: 1 }),
    quantity: Type.Integer({ minimum: 1, maximum: 1000 }),
  },
  { additionalProperties: false },
);
export type AddCartItemBody = Static<typeof AddCartItemBody>;

export const SetCartItemBody = Type.Object(
  { quantity: Type.Integer({ minimum: 1, maximum: 1000 }) },
  { additionalProperties: false },
);
export type SetCartItemBody = Static<typeof SetCartItemBody>;

export const ProductIdParams = Type.Object({
  productId: Type.Integer({ minimum: 1 }),
});
export type ProductIdParams = Static<typeof ProductIdParams>;

import { Type, type Static } from "@sinclair/typebox";
import {
  Nullable,
  PaginationQuery,
  StringEnum,
} from "../../common/schemas/common.js";
import { INVENTORY_REASONS } from "./inventory.types.js";

export const InventoryHistorySchema = Type.Object({
  id: Type.Integer(),
  productId: Type.Integer(),
  delta: Type.Integer(),
  quantityAfter: Type.Integer(),
  reason: StringEnum(INVENTORY_REASONS),
  orderId: Nullable(Type.Integer()),
  createdBy: Nullable(Type.Integer()),
  notes: Nullable(Type.String()),
  createdAt: Type.String(),
});
export type InventoryHistoryDto = Static<typeof InventoryHistorySchema>;

export const ListInventoryQuery = Type.Composite([
  PaginationQuery,
  Type.Object({
    productId: Type.Optional(Type.Integer({ minimum: 1 })),
    reason: Type.Optional(StringEnum(INVENTORY_REASONS)),
  }),
]);
export type ListInventoryQuery = Static<typeof ListInventoryQuery>;

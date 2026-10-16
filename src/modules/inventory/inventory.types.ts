export const INVENTORY_REASONS = [
  "import",
  "adjustment",
  "order_placed",
  "order_cancelled",
] as const;
export type InventoryReason = (typeof INVENTORY_REASONS)[number];

export interface InventoryHistoryRow {
  id: number;
  product_id: number;
  delta: number;
  quantity_after: number;
  reason: InventoryReason;
  order_id: number | null;
  created_by: number | null;
  notes: string | null;
  created_at: Date;
}

export interface InventoryEntry {
  productId: number;
  delta: number;
  quantityAfter: number;
  reason: InventoryReason;
  orderId?: number;
  createdBy?: number | null;
  notes?: string | null;
}

export interface InventoryFilter {
  page: number;
  perPage: number;
  productId?: number;
  reason?: InventoryReason;
}

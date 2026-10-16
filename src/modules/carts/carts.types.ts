export interface CartRow {
  id: number;
  user_id: number;
}

export interface CartLineRow {
  product_id: number;
  quantity: number;
  name: string;
  unit: string;
  price: number;
  status: "active" | "inactive";
  stock: number;
  deleted_at: Date | null;
}

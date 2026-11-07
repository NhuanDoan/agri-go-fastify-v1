export interface CartRow {
  id: number;
  user_id: number;
}

export interface CartLineRow {
  product_id: number;
  quantity: number;
  name: string;
  image_url: string | null;
  discount_percent: number;
  average_rating: number | null;
  sold_count: number;
  unit: string;
  price: number;
  status: "active" | "inactive";
  stock: number;
  deleted_at: Date | null;
}

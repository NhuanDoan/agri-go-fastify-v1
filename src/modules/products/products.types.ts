export const PRODUCT_STATUSES = ["active", "inactive"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_SORTS = [
  "newest",
  "price_asc",
  "price_desc",
  "name",
] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export interface ProductRow {
  id: number;
  category_id: number;
  name: string;
  slug: string;
  description: string | null;
  price: number; // integer VND, never a float
  quantity: number;
  unit: string;
  status: ProductStatus;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ProductWithCategory extends ProductRow {
  category_name: string;
  category_slug: string;
}

export interface ProductFilter {
  page: number;
  perPage: number;
  q?: string;
  categoryId?: number;
  status?: ProductStatus;
  minPrice?: number;
  maxPrice?: number;
  sort?: ProductSort;
}

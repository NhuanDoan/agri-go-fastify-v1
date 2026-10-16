export interface ReviewRow {
  id: number;
  user_id: number;
  product_id: number;
  rating: number;
  comment: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ReviewWithUser extends ReviewRow {
  user_full_name: string;
  user_avatar_url: string | null;
}

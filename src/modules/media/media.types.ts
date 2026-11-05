export interface CloudinaryCleanupRow {
  id: number;
  public_id: string;
  attempts: number;
  available_at: Date;
  locked_until: Date | null;
  lock_token: string | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

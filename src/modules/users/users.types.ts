export const USER_ROLES = ["admin", "customer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ["active", "locked"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** A row of the `users` table. */
export interface UserRow {
  id: number;
  full_name: string;
  email: string;
  email_verified_at: Date | null;
  password_hash: string;
  phone: string | null;
  avatar_url: string | null;
  avatar_public_id: string | null;
  address: string | null;
  role: UserRole;
  status: UserStatus;
  created_at: Date;
  updated_at: Date;
}

export interface UserFilter {
  page: number;
  perPage: number;
  q?: string;
  role?: UserRole;
  status?: UserStatus;
}

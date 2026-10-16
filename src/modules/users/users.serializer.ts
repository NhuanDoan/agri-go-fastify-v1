import type { UserDto } from "./users.schema.js";
import type { UserRow } from "./users.types.js";

export const toUserDto = (u: UserRow): UserDto => ({
  id: u.id,
  fullName: u.full_name,
  email: u.email,
  emailVerifiedAt: u.email_verified_at?.toISOString() ?? null,
  phone: u.phone,
  address: u.address,
  avatarUrl: u.avatar_url,
  role: u.role,
  status: u.status,
  createdAt: u.created_at.toISOString(),
  updatedAt: u.updated_at.toISOString(),
});

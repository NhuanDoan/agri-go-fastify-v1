export interface RefreshTokenRow {
  id: string;
  user_id: number;
  family_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by: string | null;
  user_agent: string | null;
  ip: string | null;
  created_at: Date;
}

export interface ClientMeta {
  userAgent?: string;
  ip?: string;
}

export type OtpPurpose = "email_verification" | "password_reset";

export interface OtpRow {
  id: number;
  user_id: number;
  purpose: OtpPurpose;
  code_hash: string;
  attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

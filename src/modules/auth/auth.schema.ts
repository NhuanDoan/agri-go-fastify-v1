import { Type, type Static } from "@sinclair/typebox";
import { PhoneSchema } from "../../common/schemas/common.js";
import { PasswordSchema, UserSchema } from "../users/users.schema.js";

export const RegisterBody = Type.Object(
  {
    fullName: Type.String({ minLength: 1, maxLength: 100 }),
    email: Type.String({ format: "email", maxLength: 191 }),
    password: PasswordSchema,
    phone: Type.Optional(PhoneSchema),
  },
  { additionalProperties: false },
);
export type RegisterBody = Static<typeof RegisterBody>;

export const LoginBody = Type.Object(
  {
    email: Type.String({ format: "email", maxLength: 191 }),
    password: Type.String({ minLength: 1, maxLength: 72 }),
  },
  { additionalProperties: false },
);
export type LoginBody = Static<typeof LoginBody>;

export const RefreshBody = Type.Object(
  { refreshToken: Type.String({ minLength: 10 }) },
  { additionalProperties: false },
);
export type RefreshBody = Static<typeof RefreshBody>;

export const ChangePasswordBody = Type.Object(
  {
    currentPassword: Type.String({ minLength: 1, maxLength: 72 }),
    newPassword: PasswordSchema,
  },
  { additionalProperties: false },
);
export type ChangePasswordBody = Static<typeof ChangePasswordBody>;

export const TokensSchema = Type.Object({
  accessToken: Type.String(),
  refreshToken: Type.String(),
  tokenType: Type.Literal("Bearer"),
  expiresIn: Type.Integer(), // access-token lifetime in seconds
});

export const SessionSchema = Type.Object({
  user: UserSchema,
  tokens: TokensSchema,
});

const email = Type.String({ format: "email", maxLength: 191 });
const otpCode = Type.String({ pattern: "^[0-9]{6}$" });

export const VerifyEmailBody = Type.Object(
  { email, code: otpCode },
  { additionalProperties: false },
);
export type VerifyEmailBody = Static<typeof VerifyEmailBody>;

export const EmailBody = Type.Object(
  { email },
  { additionalProperties: false },
);
export type EmailBody = Static<typeof EmailBody>;

export const ResetPasswordBody = Type.Object(
  { email, code: otpCode, newPassword: PasswordSchema },
  { additionalProperties: false },
);
export type ResetPasswordBody = Static<typeof ResetPasswordBody>;

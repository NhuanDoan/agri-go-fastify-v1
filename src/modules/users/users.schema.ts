import { Type, type Static } from "@sinclair/typebox";
import {
  Nullable,
  PaginationQuery,
  PhoneSchema,
  StringEnum,
} from "../../common/schemas/common.js";
import { USER_ROLES, USER_STATUSES } from "./users.types.js";

/** Public shape of a user. password_hash is absent on purpose: response schemas strip anything not listed. */
export const UserSchema = Type.Object({
  id: Type.Integer(),
  fullName: Type.String(),
  email: Type.String(),
  emailVerifiedAt: Nullable(Type.String()),
  phone: Nullable(Type.String()),
  address: Nullable(Type.String()),
  avatarUrl: Nullable(Type.String()),
  role: StringEnum(USER_ROLES),
  status: StringEnum(USER_STATUSES),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type UserDto = Static<typeof UserSchema>;

export const PasswordSchema = Type.String({ minLength: 8, maxLength: 72 }); // bcrypt only uses the first 72 bytes

/** Admin creates an account. */
export const CreateUserBody = Type.Object(
  {
    fullName: Type.String({ minLength: 1, maxLength: 100 }),
    email: Type.String({ format: "email", maxLength: 191 }),
    password: PasswordSchema,
    phone: Type.Optional(PhoneSchema),
    role: Type.Optional(StringEnum(USER_ROLES)),
    status: Type.Optional(StringEnum(USER_STATUSES)),
  },
  { additionalProperties: false },
);
export type CreateUserBody = Static<typeof CreateUserBody>;

export const UpdateUserBody = Type.Partial(CreateUserBody);
export type UpdateUserBody = Static<typeof UpdateUserBody>;

/** What a customer may change about themselves. No role, no status, no email. */
export const UpdateProfileBody = Type.Object(
  {
    fullName: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    phone: Type.Optional(Nullable(PhoneSchema)),
    address: Type.Optional(Nullable(Type.String({ maxLength: 500 }))),
    avatarUrl: Type.Optional(
      Nullable(Type.String({ format: "uri", maxLength: 500 })),
    ),
  },
  { additionalProperties: false },
);
export type UpdateProfileBody = Static<typeof UpdateProfileBody>;

export const ListUsersQuery = Type.Composite([
  PaginationQuery,
  Type.Object({
    q: Type.Optional(Type.String({ maxLength: 100 })),
    role: Type.Optional(StringEnum(USER_ROLES)),
    status: Type.Optional(StringEnum(USER_STATUSES)),
  }),
]);
export type ListUsersQuery = Static<typeof ListUsersQuery>;

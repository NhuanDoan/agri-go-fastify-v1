import { Type, type Static, type TSchema } from "@sinclair/typebox";

/** Keeps the TS union type while emitting a plain JSON-schema `enum`. */
export const StringEnum = <T extends string>(values: readonly T[]) =>
  Type.Unsafe<T>(Type.String({ enum: [...values] }));

/**
 * Null FIRST on purpose. Ajv coerces types, so `[String, Null]` would turn a real `null`
 * into "" (it tries the String branch first and coercion succeeds).
 */
export const Nullable = <T extends TSchema>(schema: T) =>
  Type.Union([Type.Null(), schema]);

export const IdParams = Type.Object({ id: Type.Integer({ minimum: 1 }) });
export type IdParams = Static<typeof IdParams>;

export const PaginationQuery = Type.Object({
  page: Type.Integer({ minimum: 1, default: 1 }),
  perPage: Type.Integer({ minimum: 1, maximum: 100, default: 15 }),
});
export type PaginationQuery = Static<typeof PaginationQuery>;

export const PaginationMetaSchema = Type.Object({
  page: Type.Integer(),
  perPage: Type.Integer(),
  total: Type.Integer(),
  totalPages: Type.Integer(),
});

export const successOf = <T extends TSchema>(data: T) =>
  Type.Object({ success: Type.Literal(true), message: Type.String(), data });

export const paginatedOf = <T extends TSchema>(item: T) =>
  Type.Object({
    success: Type.Literal(true),
    message: Type.String(),
    data: Type.Array(item),
    meta: PaginationMetaSchema,
  });

export const ErrorResponse = Type.Object({
  success: Type.Literal(false),
  message: Type.String(),
  code: Type.Optional(Type.String()),
  errors: Type.Optional(Type.Any()),
  requestId: Type.Optional(Type.String()),
});

/** Spread into a route's `response` to document the usual failures. */
export const commonErrors = {
  400: ErrorResponse,
  422: ErrorResponse,
  429: ErrorResponse,
};
export const securedErrors = {
  ...commonErrors,
  401: ErrorResponse,
  403: ErrorResponse,
};

export const bearerSecurity = [{ bearerAuth: [] }];

export const PhoneSchema = Type.String({ pattern: "^[0-9+()\\-\\s]{8,20}$" });

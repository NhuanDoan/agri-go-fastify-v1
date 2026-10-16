import { Type, type Static } from "@sinclair/typebox";
import {
  Nullable,
  PaginationQuery,
  StringEnum,
} from "../../common/schemas/common.js";
import { PRODUCT_SORTS, PRODUCT_STATUSES } from "./products.types.js";

export const ProductSchema = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  slug: Type.String(),
  description: Nullable(Type.String()),
  price: Type.Integer(),
  quantity: Type.Integer(),
  unit: Type.String(),
  status: StringEnum(PRODUCT_STATUSES),
  category: Type.Object({
    id: Type.Integer(),
    name: Type.String(),
    slug: Type.String(),
  }),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type ProductDto = Static<typeof ProductSchema>;

// No `default` keywords in body schemas: UpdateProductBody is a Partial of this, and Ajv's useDefaults
// would silently re-apply defaults on every update. Defaults live in the service instead.
export const CreateProductBody = Type.Object(
  {
    categoryId: Type.Integer({ minimum: 1 }),
    name: Type.String({ minLength: 1, maxLength: 191 }),
    description: Type.Optional(Nullable(Type.String({ maxLength: 5000 }))),
    price: Type.Integer({ minimum: 0 }),
    quantity: Type.Optional(Type.Integer({ minimum: 0 })), // initial stock
    unit: Type.Optional(Type.String({ minLength: 1, maxLength: 20 })),
    status: Type.Optional(StringEnum(PRODUCT_STATUSES)),
  },
  { additionalProperties: false },
);
export type CreateProductBody = Static<typeof CreateProductBody>;

// Stock is not editable here: it changes only through PATCH /:id/quantity so the ledger stays complete.
export const UpdateProductBody = Type.Partial(
  Type.Omit(CreateProductBody, ["quantity"]),
);
export type UpdateProductBody = Static<typeof UpdateProductBody>;

export const SetStatusBody = Type.Object(
  { status: StringEnum(PRODUCT_STATUSES) },
  { additionalProperties: false },
);
export type SetStatusBody = Static<typeof SetStatusBody>;

export const SetQuantityBody = Type.Object(
  {
    quantity: Type.Integer({ minimum: 0 }),
    notes: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);
export type SetQuantityBody = Static<typeof SetQuantityBody>;

export const ListProductsQuery = Type.Composite([
  PaginationQuery,
  Type.Object({
    q: Type.Optional(Type.String({ maxLength: 100 })),
    categoryId: Type.Optional(Type.Integer({ minimum: 1 })),
    status: Type.Optional(StringEnum(PRODUCT_STATUSES)), // honoured for admins only
    minPrice: Type.Optional(Type.Integer({ minimum: 0 })),
    maxPrice: Type.Optional(Type.Integer({ minimum: 0 })),
    sort: Type.Optional(StringEnum(PRODUCT_SORTS)),
  }),
]);
export type ListProductsQuery = Static<typeof ListProductsQuery>;

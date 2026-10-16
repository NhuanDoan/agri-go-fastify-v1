import { Type, type Static } from "@sinclair/typebox";
import { Nullable, PaginationQuery } from "../../common/schemas/common.js";

export const CategorySchema = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  slug: Type.String(),
  description: Nullable(Type.String()),
  imageUrl: Nullable(Type.String()),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type CategoryDto = Static<typeof CategorySchema>;

export const CreateCategoryBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 100 }),
    description: Type.Optional(Nullable(Type.String({ maxLength: 2000 }))),
  },
  { additionalProperties: false },
);
export type CreateCategoryBody = Static<typeof CreateCategoryBody>;

export const UpdateCategoryBody = Type.Partial(CreateCategoryBody);
export type UpdateCategoryBody = Static<typeof UpdateCategoryBody>;

export const ListCategoriesQuery = Type.Composite([
  PaginationQuery,
  Type.Object({ q: Type.Optional(Type.String({ maxLength: 100 })) }),
]);
export type ListCategoriesQuery = Static<typeof ListCategoriesQuery>;

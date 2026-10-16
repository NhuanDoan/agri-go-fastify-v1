import type { CategoryDto } from "./categories.schema.js";
import type { CategoryRow } from "./categories.types.js";

export const toCategoryDto = (c: CategoryRow): CategoryDto => ({
  id: c.id,
  name: c.name,
  slug: c.slug,
  description: c.description,
  imageUrl: c.image_url,
  createdAt: c.created_at.toISOString(),
  updatedAt: c.updated_at.toISOString(),
});

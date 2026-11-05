import type { ProductDto } from "./products.schema.js";
import type { ProductWithCategory } from "./products.types.js";

export const toProductDto = (p: ProductWithCategory): ProductDto => ({
  id: p.id,
  name: p.name,
  slug: p.slug,
  description: p.description,
  price: p.price,
  quantity: p.quantity,
  unit: p.unit,
  status: p.status,
  category: { id: p.category_id, name: p.category_name, slug: p.category_slug },
  images: p.images.map((image) => ({
    id: image.id,
    url: image.image_url,
    publicId: image.public_id ?? "",
    isPrimary: image.is_primary,
    sortOrder: image.sort_order,
  })),
  createdAt: p.created_at.toISOString(),
  updatedAt: p.updated_at.toISOString(),
});

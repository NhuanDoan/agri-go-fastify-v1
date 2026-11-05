import type { Knex } from "knex";
import { NotFoundError } from "../../common/errors/app-error.js";
import type { AuthUser } from "../../common/security/token.service.js";
import type { CloudinaryService } from "../media/cloudinary.service.js";
import type { CloudinaryImageBody } from "../media/media.schema.js";
import type { ProductsRepository } from "./products.repository.js";
import type { ProductImageRow } from "./products.types.js";
import { ProductImagesRepository } from "./product-images.repository.js";
import type { CloudinaryCleanupService } from "../media/cloudinary-cleanup.service.js";

export class ProductImagesService {
  constructor(
    private readonly db: Knex,
    private readonly repo: ProductImagesRepository,
    private readonly products: ProductsRepository,
    private readonly media: CloudinaryService,
    private readonly cleanup: CloudinaryCleanupService,
  ) {}

  async list(productId: number, actor: AuthUser | null): Promise<ProductImageRow[]> {
    const product = await this.products.findById(productId);
    if (
      !product ||
      (product.status !== "active" && actor?.role !== "admin")
    ) {
      throw new NotFoundError("Product not found");
    }
    return this.repo.listByProductIds([productId]);
  }

  async add(
    productId: number,
    image: CloudinaryImageBody,
    isPrimary = false,
    sortOrder?: number,
  ): Promise<ProductImageRow> {
    await this.assertProduct(productId);
    const verified = await this.media.verifyImage(
      image,
      this.media.folder("products", productId),
    );
    const existing = await this.repo.listByProductIds([productId]);
    const primary = isPrimary || existing.length === 0;
    const resolvedSortOrder = sortOrder ?? existing.length;
    return this.db.transaction(async (trx) => {
      if (primary) {
        await trx("product_images").where({ product_id: productId }).update({ is_primary: false });
      }
      return this.repo.add(
        {
          product_id: productId,
          image_url: verified.secureUrl,
          public_id: verified.publicId,
          is_primary: primary,
          sort_order: resolvedSortOrder,
        },
        trx,
      );
    });
  }

  async addFile(
    productId: number,
    buffer: Buffer,
    mimetype: string,
    isPrimary = false,
    sortOrder?: number,
  ): Promise<ProductImageRow> {
    await this.assertProduct(productId);
    const image = await this.media.uploadImage(
      buffer,
      this.media.folder("products", productId),
      mimetype,
    );
    try {
      return await this.add(productId, image, isPrimary, sortOrder);
    } catch (error) {
      await this.cleanup.cleanupOrphan(image.publicId);
      throw error;
    }
  }

  async update(
    productId: number,
    imageId: number,
    input: { isPrimary?: boolean; sortOrder?: number },
  ): Promise<ProductImageRow> {
    await this.assertProduct(productId);
    const current = await this.repo.findById(productId, imageId);
    if (!current) throw new NotFoundError("Product image not found");
    await this.db.transaction(async (trx) => {
      if (input.isPrimary === true) {
        await trx("product_images").where({ product_id: productId }).update({ is_primary: false });
      } else if (input.isPrimary === false && current.is_primary) {
        const next = await trx<ProductImageRow>("product_images")
          .where({ product_id: productId })
          .whereNot({ id: imageId })
          .orderBy([{ column: "sort_order", order: "asc" }, { column: "id", order: "asc" }])
          .first();
        if (next) await this.repo.update(next.id, { is_primary: true }, trx);
      }
      const patch: { is_primary?: boolean; sort_order?: number } = {};
      if (input.isPrimary !== undefined) patch.is_primary = input.isPrimary;
      if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
      await this.repo.update(
        imageId,
        patch,
        trx,
      );
    });
    return (await this.repo.findById(productId, imageId))!;
  }

  async remove(productId: number, imageId: number): Promise<void> {
    await this.assertProduct(productId);
    const image = await this.repo.findById(productId, imageId);
    if (!image) throw new NotFoundError("Product image not found");
    await this.db.transaction(async (trx) => {
      await this.repo.delete(imageId, trx);
      if (image.is_primary) {
        const next = await trx<ProductImageRow>("product_images")
          .where({ product_id: productId })
          .orderBy([{ column: "sort_order", order: "asc" }, { column: "id", order: "asc" }])
          .first();
        if (next) await this.repo.update(next.id, { is_primary: true }, trx);
      }
      if (image.public_id) await this.cleanup.enqueue(trx, image.public_id);
    });
  }

  private async assertProduct(productId: number): Promise<void> {
    if (!(await this.products.findById(productId))) {
      throw new NotFoundError("Product not found");
    }
  }
}

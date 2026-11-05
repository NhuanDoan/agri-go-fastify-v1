import { ConflictError, NotFoundError } from "../../common/errors/app-error.js";
import type { Paged } from "../../common/utils/pagination.js";
import { slugify } from "../../common/utils/slugify.js";
import type { CategoriesRepository } from "./categories.repository.js";
import type {
  CreateCategoryBody,
  ListCategoriesQuery,
  UpdateCategoryBody,
} from "./categories.schema.js";
import type { CategoryRow } from "./categories.types.js";
import type { CloudinaryService } from "../media/cloudinary.service.js";
import type { CloudinaryImageBody } from "../media/media.schema.js";
import type { CloudinaryCleanupService } from "../media/cloudinary-cleanup.service.js";
import type { Knex } from "knex";

export class CategoriesService {
  constructor(
    private readonly db: Knex,
    private readonly repo: CategoriesRepository,
    private readonly media: CloudinaryService,
    private readonly cleanup: CloudinaryCleanupService,
  ) {}

  list(q: ListCategoriesQuery): Promise<Paged<CategoryRow>> {
    return this.repo.list(q.page, q.perPage, q.q);
  }

  async getById(id: number): Promise<CategoryRow> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundError("Category not found");
    return row;
  }

  async create(input: CreateCategoryBody): Promise<CategoryRow> {
    const name = input.name.trim();
    const slug = slugify(name);
    // "Rau củ quả" and "Rau cu qua" are different names but the SAME slug: both must be refused
    if (
      (await this.repo.findByName(name)) ||
      (await this.repo.slugExists(slug))
    ) {
      throw new ConflictError("Category already exists");
    }
    const id = await this.repo.create({
      name,
      slug,
      description: input.description ?? null,
    });
    return this.getById(id);
  }

  async update(id: number, input: UpdateCategoryBody): Promise<CategoryRow> {
    await this.getById(id);
    const patch: Partial<CategoryRow> = {};

    if (input.name !== undefined) {
      const name = input.name.trim();
      const slug = slugify(name);
      const sameName = await this.repo.findByName(name);
      if (
        (sameName && sameName.id !== id) ||
        (await this.repo.slugExists(slug, id))
      ) {
        throw new ConflictError("Category already exists");
      }
      patch.name = name;
      patch.slug = slug;
    }
    if (input.description !== undefined) patch.description = input.description;

    if (Object.keys(patch).length > 0) await this.repo.update(id, patch);
    return this.getById(id);
  }

  async remove(id: number): Promise<void> {
    const category = await this.getById(id);
    if ((await this.repo.countProducts(id)) > 0) {
      throw new ConflictError(
        "Cannot delete a category that still has products",
      );
    }
    await this.repoDeleteWithCleanup(id, category.image_public_id);
  }

  async setImage(id: number, image: CloudinaryImageBody): Promise<CategoryRow> {
    const category = await this.getById(id);
    const verified = await this.media.verifyImage(image, this.folder(id));
    await this.repoUpdateWithCleanup(id, verified, category.image_public_id);
    return this.getById(id);
  }

  async setImageFile(
    id: number,
    buffer: Buffer,
    mimetype: string,
  ): Promise<CategoryRow> {
    await this.getById(id);
    const image = await this.media.uploadImage(buffer, this.folder(id), mimetype);
    try {
      return await this.setImage(id, image);
    } catch (error) {
      await this.cleanup.cleanupOrphan(image.publicId);
      throw error;
    }
  }

  async removeImage(id: number): Promise<CategoryRow> {
    const category = await this.getById(id);
    await this.repoUpdateWithCleanup(id, null, category.image_public_id);
    return this.getById(id);
  }

  private async repoDeleteWithCleanup(
    id: number,
    publicId: string | null,
  ): Promise<void> {
    await this.repoDbTransaction(async (trx) => {
      await trx("categories").where({ id }).delete();
      if (publicId) await this.cleanup.enqueue(trx, publicId);
    });
  }

  private async repoUpdateWithCleanup(
    id: number,
    image: CloudinaryImageBody | null,
    previousPublicId: string | null,
  ): Promise<void> {
    await this.repoDbTransaction(async (trx) => {
      await trx("categories")
        .where({ id })
        .update(
          image
            ? { image_url: image.secureUrl, image_public_id: image.publicId }
            : { image_url: null, image_public_id: null },
        );
      if (previousPublicId && previousPublicId !== image?.publicId) {
        await this.cleanup.enqueue(trx, previousPublicId);
      }
    });
  }

  private repoDbTransaction<T>(
    work: (trx: Knex.Transaction) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(work);
  }

  private folder(id: number): string {
    return this.media.folder("categories", id);
  }
}

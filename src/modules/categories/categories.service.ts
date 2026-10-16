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

export class CategoriesService {
  constructor(private readonly repo: CategoriesRepository) {}

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
    await this.getById(id);
    if ((await this.repo.countProducts(id)) > 0) {
      throw new ConflictError(
        "Cannot delete a category that still has products",
      );
    }
    await this.repo.delete(id);
  }
}

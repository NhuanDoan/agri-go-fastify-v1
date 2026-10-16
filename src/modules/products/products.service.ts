import type { Knex } from "knex";
import { randomBytes } from "node:crypto";
import {
  NotFoundError,
  UnprocessableError,
} from "../../common/errors/app-error.js";
import type { AuthUser } from "../../common/security/token.service.js";
import type { Paged } from "../../common/utils/pagination.js";
import { slugify } from "../../common/utils/slugify.js";
import type { CategoriesRepository } from "../categories/categories.repository.js";
import type { InventoryRepository } from "../inventory/inventory.repository.js";
import type { ProductsRepository } from "./products.repository.js";
import type {
  CreateProductBody,
  UpdateProductBody,
} from "./products.schema.js";
import type {
  ProductFilter,
  ProductRow,
  ProductStatus,
  ProductWithCategory,
} from "./products.types.js";

export class ProductsService {
  constructor(
    private readonly db: Knex,
    private readonly repo: ProductsRepository,
    private readonly categories: CategoriesRepository,
    private readonly inventory: InventoryRepository,
  ) {}

  /** Visibility rule: only admins can see (or filter by) inactive products. */
  list(
    filter: ProductFilter,
    actor: AuthUser | null,
  ): Promise<Paged<ProductWithCategory>> {
    const isAdmin = actor?.role === "admin";
    return this.repo.list({
      ...filter,
      status: isAdmin ? filter.status : "active",
    });
  }

  async get(id: number, actor: AuthUser | null): Promise<ProductWithCategory> {
    const product = await this.repo.findById(id);
    // 404, not 403: don't reveal that a hidden product exists
    if (!product || (product.status !== "active" && actor?.role !== "admin")) {
      throw new NotFoundError("Product not found");
    }
    return product;
  }

  async create(
    input: CreateProductBody,
    actorId: number,
  ): Promise<ProductWithCategory> {
    await this.assertCategory(input.categoryId);
    const name = input.name.trim();
    const slug = await this.uniqueSlug(name);
    const quantity = input.quantity ?? 0;

    // product row + its first ledger entry commit together or not at all
    const id = await this.db.transaction(async (trx) => {
      const newId = await this.repo.create(
        {
          category_id: input.categoryId,
          name,
          slug,
          description: input.description ?? null,
          price: input.price,
          quantity,
          unit: input.unit ?? "kg",
          status: input.status ?? "active",
        },
        trx,
      );
      if (quantity > 0) {
        await this.inventory.record(trx, {
          productId: newId,
          delta: quantity,
          quantityAfter: quantity,
          reason: "import",
          createdBy: actorId,
          notes: "Initial stock",
        });
      }
      return newId;
    });
    return this.mustFind(id);
  }

  async update(
    id: number,
    input: UpdateProductBody,
  ): Promise<ProductWithCategory> {
    await this.mustFind(id);
    const patch: Partial<ProductRow> = {};

    if (input.categoryId !== undefined) {
      await this.assertCategory(input.categoryId);
      patch.category_id = input.categoryId;
    }
    if (input.name !== undefined) patch.name = input.name.trim(); // the slug never changes: stable URLs
    if (input.description !== undefined) patch.description = input.description;
    if (input.price !== undefined) patch.price = input.price;
    if (input.unit !== undefined) patch.unit = input.unit;
    if (input.status !== undefined) patch.status = input.status;

    if (Object.keys(patch).length > 0) await this.repo.update(id, patch);
    return this.mustFind(id);
  }

  async setStatus(
    id: number,
    status: ProductStatus,
  ): Promise<ProductWithCategory> {
    await this.mustFind(id);
    await this.repo.update(id, { status });
    return this.mustFind(id);
  }

  /** Absolute stock correction: row-locked, and written to the ledger in the same transaction. */
  async setQuantity(
    id: number,
    quantity: number,
    notes: string | undefined,
    actorId: number,
  ): Promise<ProductWithCategory> {
    await this.db.transaction(async (trx) => {
      const row = await this.repo.findByIdForUpdate(id, trx);
      if (!row) throw new NotFoundError("Product not found");
      const delta = quantity - row.quantity;
      if (delta === 0) return; // nothing changed, nothing to record
      await this.repo.update(id, { quantity }, trx);
      await this.inventory.record(trx, {
        productId: id,
        delta,
        quantityAfter: quantity,
        reason: delta > 0 && row.quantity === 0 ? "import" : "adjustment",
        createdBy: actorId,
        notes: notes ?? null,
      });
    });
    return this.mustFind(id);
  }

  async remove(id: number): Promise<void> {
    await this.mustFind(id);
    await this.repo.softDelete(id);
  }

  private async mustFind(id: number): Promise<ProductWithCategory> {
    const product = await this.repo.findById(id);
    if (!product) throw new NotFoundError("Product not found");
    return product;
  }

  private async assertCategory(categoryId: number): Promise<void> {
    if (!(await this.categories.findById(categoryId))) {
      throw new UnprocessableError("Category does not exist", [
        { field: "categoryId", message: "Category does not exist" },
      ]);
    }
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || "product";
    if (!(await this.repo.slugExists(base))) return base;
    return `${base}-${randomBytes(3).toString("hex")}`;
  }
}

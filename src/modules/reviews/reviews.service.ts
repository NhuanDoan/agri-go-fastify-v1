import type { Knex } from "knex";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../common/errors/app-error.js";
import type { AuthUser } from "../../common/security/token.service.js";
import type { Paged } from "../../common/utils/pagination.js";
import type { ProductsService } from "../products/products.service.js";
import type { ReviewsRepository } from "./reviews.repository.js";
import type {
  CreateReviewBody,
  ReviewSummaryDto,
  UpdateReviewBody,
} from "./reviews.schema.js";
import type { ReviewRow, ReviewWithUser } from "./reviews.types.js";

export class ReviewsService {
  constructor(
    private readonly knex: Knex,
    private readonly repo: ReviewsRepository,
    // reused on purpose: "who may see this product" is decided in ONE place, and reviews inherit it
    private readonly products: ProductsService,
  ) {}

  async list(
    productId: number,
    actor: AuthUser | null,
    page: number,
    perPage: number,
  ): Promise<Paged<ReviewWithUser>> {
    await this.products.get(productId, actor); // 404 for hidden, inactive (non-admin) and deleted products
    return this.repo.listByProduct(this.knex, productId, page, perPage);
  }

  async summary(
    productId: number,
    actor: AuthUser | null,
  ): Promise<ReviewSummaryDto> {
    await this.products.get(productId, actor);
    const distribution = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    let count = 0;
    let sum = 0;
    for (const row of await this.repo.ratingCounts(this.knex, productId)) {
      distribution[String(row.rating) as keyof typeof distribution] = row.total;
      count += row.total;
      sum += row.rating * row.total;
    }
    return {
      count,
      average: count ? Math.round((sum / count) * 10) / 10 : null,
      distribution,
    };
  }

  async create(
    actor: AuthUser,
    productId: number,
    input: CreateReviewBody,
  ): Promise<ReviewWithUser> {
    await this.products.get(productId, actor);
    if (!(await this.repo.hasPurchased(this.knex, actor.id, productId))) {
      throw new ForbiddenError(
        "Only customers who received this product can review it",
      );
    }
    // the unique index is the real guard (two requests can pass this check together); this gives a friendly message
    if (await this.repo.findByUserAndProduct(this.knex, actor.id, productId)) {
      throw new ConflictError("You have already reviewed this product");
    }
    const id = await this.repo.create(this.knex, {
      user_id: actor.id,
      product_id: productId,
      rating: input.rating,
      comment: input.comment?.trim() || null,
    });
    return (await this.repo.findWithUser(this.knex, id))!;
  }

  async update(
    actor: AuthUser,
    id: number,
    input: UpdateReviewBody,
  ): Promise<ReviewWithUser> {
    const review = await this.repo.findById(this.knex, id);
    if (!review) throw new NotFoundError("Review not found");
    // not even admins edit someone else's words; they can delete
    if (review.user_id !== actor.id)
      throw new ForbiddenError("You can only edit your own review");

    const patch: Partial<ReviewRow> = {};
    if (input.rating !== undefined) patch.rating = input.rating;
    if (input.comment !== undefined)
      patch.comment = input.comment?.trim() || null;
    if (Object.keys(patch).length > 0)
      await this.repo.update(this.knex, id, patch);
    return (await this.repo.findWithUser(this.knex, id))!;
  }

  async remove(actor: AuthUser, id: number): Promise<void> {
    const review = await this.repo.findById(this.knex, id);
    if (!review) throw new NotFoundError("Review not found");
    if (review.user_id !== actor.id && actor.role !== "admin")
      throw new ForbiddenError("You cannot delete this review");
    await this.repo.delete(this.knex, id);
  }
}

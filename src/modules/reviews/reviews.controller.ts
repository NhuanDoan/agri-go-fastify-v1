import type { FastifyReply, FastifyRequest } from "fastify";
import type { IdParams } from "../../common/schemas/common.js";
import { buildMeta } from "../../common/utils/pagination.js";
import { ok, paginated } from "../../common/utils/response.js";
import { currentUser } from "../../plugins/auth.js";
import type {
  CreateReviewBody,
  ListReviewsQuery,
  ReviewDto,
  UpdateReviewBody,
} from "./reviews.schema.js";
import type { ReviewsService } from "./reviews.service.js";
import type { ReviewWithUser } from "./reviews.types.js";

const toReviewDto = (r: ReviewWithUser): ReviewDto => ({
  id: r.id,
  rating: r.rating,
  comment: r.comment,
  user: {
    id: r.user_id,
    fullName: r.user_full_name,
    avatarUrl: r.user_avatar_url,
  },
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}

  list = async (
    request: FastifyRequest<{
      Params: IdParams;
      Querystring: ListReviewsQuery;
    }>,
  ) => {
    const { page, perPage } = request.query;
    const { items, total } = await this.service.list(
      request.params.id,
      request.user,
      page,
      perPage,
    );
    return paginated(items.map(toReviewDto), buildMeta(page, perPage, total));
  };

  summary = async (request: FastifyRequest<{ Params: IdParams }>) =>
    ok(await this.service.summary(request.params.id, request.user));

  create = async (
    request: FastifyRequest<{ Params: IdParams; Body: CreateReviewBody }>,
    reply: FastifyReply,
  ) => {
    const review = await this.service.create(
      currentUser(request),
      request.params.id,
      request.body,
    );
    reply.code(201);
    return ok(toReviewDto(review), "Review created");
  };

  update = async (
    request: FastifyRequest<{ Params: IdParams; Body: UpdateReviewBody }>,
  ) =>
    ok(
      toReviewDto(
        await this.service.update(
          currentUser(request),
          request.params.id,
          request.body,
        ),
      ),
      "Review updated",
    );

  remove = async (request: FastifyRequest<{ Params: IdParams }>) => {
    await this.service.remove(currentUser(request), request.params.id);
    return ok(null, "Review deleted");
  };
}

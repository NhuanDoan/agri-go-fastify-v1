import { Type, type Static } from "@sinclair/typebox";
import { Nullable, PaginationQuery } from "../../common/schemas/common.js";

export const ReviewSchema = Type.Object({
  id: Type.Integer(),
  rating: Type.Integer(),
  comment: Nullable(Type.String()),
  // the author's public face only: never their email or phone
  user: Type.Object({
    id: Type.Integer(),
    fullName: Type.String(),
    avatarUrl: Nullable(Type.String()),
  }),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type ReviewDto = Static<typeof ReviewSchema>;

export const ReviewSummarySchema = Type.Object({
  count: Type.Integer(),
  average: Nullable(Type.Number()), // one decimal, null when there are no reviews
  distribution: Type.Object({
    "1": Type.Integer(),
    "2": Type.Integer(),
    "3": Type.Integer(),
    "4": Type.Integer(),
    "5": Type.Integer(),
  }),
});
export type ReviewSummaryDto = Static<typeof ReviewSummarySchema>;

export const CreateReviewBody = Type.Object(
  {
    rating: Type.Integer({ minimum: 1, maximum: 5 }),
    comment: Type.Optional(Nullable(Type.String({ maxLength: 2000 }))),
  },
  { additionalProperties: false },
);
export type CreateReviewBody = Static<typeof CreateReviewBody>;

export const UpdateReviewBody = Type.Partial(CreateReviewBody);
export type UpdateReviewBody = Static<typeof UpdateReviewBody>;

export const ListReviewsQuery = PaginationQuery;
export type ListReviewsQuery = Static<typeof ListReviewsQuery>;

import type { FastifyReply, FastifyRequest } from "fastify";
import { BadRequestError } from "../../common/errors/app-error.js";
import type { IdParams } from "../../common/schemas/common.js";
import { buildMeta } from "../../common/utils/pagination.js";
import { ok, paginated } from "../../common/utils/response.js";
import type {
  CreateCategoryBody,
  ListCategoriesQuery,
  UpdateCategoryBody,
} from "./categories.schema.js";
import { getImageUploadFile } from "../media/media.schema.js";
import { toCategoryDto } from "./categories.serializer.js";
import type { CategoriesService } from "./categories.service.js";

export class CategoriesController {
  constructor(private readonly service: CategoriesService) {}

  list = async (
    request: FastifyRequest<{ Querystring: ListCategoriesQuery }>,
  ) => {
    const { items, total } = await this.service.list(request.query);
    return paginated(
      items.map(toCategoryDto),
      buildMeta(request.query.page, request.query.perPage, total),
    );
  };

  get = async (request: FastifyRequest<{ Params: IdParams }>) =>
    ok(toCategoryDto(await this.service.getById(request.params.id)));

  create = async (
    request: FastifyRequest<{ Body: CreateCategoryBody }>,
    reply: FastifyReply,
  ) => {
    const row = await this.service.create(request.body);
    reply.code(201);
    return ok(toCategoryDto(row), "Category created");
  };

  update = async (
    request: FastifyRequest<{ Params: IdParams; Body: UpdateCategoryBody }>,
  ) =>
    ok(
      toCategoryDto(await this.service.update(request.params.id, request.body)),
      "Category updated",
    );

  remove = async (request: FastifyRequest<{ Params: IdParams }>) => {
    await this.service.remove(request.params.id);
    return ok(null, "Category deleted");
  };

  setImage = async (
    request: FastifyRequest<{ Params: IdParams }>,
  ) => {
    const file = getImageUploadFile(request.body);
    if (!file) throw new BadRequestError("Image file is required");
    const buffer = await file.toBuffer();
    const category = await this.service.setImageFile(
      request.params.id,
      buffer,
      file.mimetype,
    );
    return ok(toCategoryDto(category), "Category image updated");
  };

  removeImage = async (request: FastifyRequest<{ Params: IdParams }>) => {
    await this.service.removeImage(request.params.id);
    return ok(null, "Category image deleted");
  };
}

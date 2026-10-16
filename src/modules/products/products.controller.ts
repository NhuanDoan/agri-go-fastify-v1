import type { FastifyReply, FastifyRequest } from "fastify";
import type { IdParams } from "../../common/schemas/common.js";
import { buildMeta } from "../../common/utils/pagination.js";
import { ok, paginated } from "../../common/utils/response.js";
import { currentUser } from "../../plugins/auth.js";
import type {
  CreateProductBody,
  ListProductsQuery,
  SetQuantityBody,
  SetStatusBody,
  UpdateProductBody,
} from "./products.schema.js";
import { toProductDto } from "./products.serializer.js";
import type { ProductsService } from "./products.service.js";

export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  list = async (
    request: FastifyRequest<{ Querystring: ListProductsQuery }>,
  ) => {
    const { items, total } = await this.service.list(
      request.query,
      request.user,
    );
    return paginated(
      items.map(toProductDto),
      buildMeta(request.query.page, request.query.perPage, total),
    );
  };

  get = async (request: FastifyRequest<{ Params: IdParams }>) =>
    ok(toProductDto(await this.service.get(request.params.id, request.user)));

  create = async (
    request: FastifyRequest<{ Body: CreateProductBody }>,
    reply: FastifyReply,
  ) => {
    const product = await this.service.create(
      request.body,
      currentUser(request).id,
    );
    reply.code(201);
    return ok(toProductDto(product), "Product created");
  };

  update = async (
    request: FastifyRequest<{ Params: IdParams; Body: UpdateProductBody }>,
  ) =>
    ok(
      toProductDto(await this.service.update(request.params.id, request.body)),
      "Product updated",
    );

  setStatus = async (
    request: FastifyRequest<{ Params: IdParams; Body: SetStatusBody }>,
  ) =>
    ok(
      toProductDto(
        await this.service.setStatus(request.params.id, request.body.status),
      ),
      "Status updated",
    );

  setQuantity = async (
    request: FastifyRequest<{ Params: IdParams; Body: SetQuantityBody }>,
  ) =>
    ok(
      toProductDto(
        await this.service.setQuantity(
          request.params.id,
          request.body.quantity,
          request.body.notes,
          currentUser(request).id,
        ),
      ),
      "Quantity updated",
    );

  remove = async (request: FastifyRequest<{ Params: IdParams }>) => {
    await this.service.remove(request.params.id);
    return ok(null, "Product deleted");
  };
}

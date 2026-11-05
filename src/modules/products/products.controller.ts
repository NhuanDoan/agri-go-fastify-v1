import type { FastifyReply, FastifyRequest } from "fastify";
import { BadRequestError } from "../../common/errors/app-error.js";
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
  ProductImageUpdateBody,
} from "./products.schema.js";
import { toProductDto } from "./products.serializer.js";
import type { ProductsService } from "./products.service.js";
import type { ProductImagesService } from "./product-images.service.js";

export class ProductsController {
  constructor(
    private readonly service: ProductsService,
    private readonly images: ProductImagesService,
  ) {}

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

  listImages = async (request: FastifyRequest<{ Params: IdParams }>) =>
    ok(
      (await this.images.list(request.params.id, request.user)).map((image) => ({
        id: image.id,
        url: image.image_url,
        publicId: image.public_id ?? "",
        isPrimary: image.is_primary,
        sortOrder: image.sort_order,
      })),
    );

  addImage = async (
    request: FastifyRequest<{
      Params: IdParams;
    }>,
  ) => {
    const part = await request.file();
    if (!part) throw new BadRequestError("Image file is required");
    const buffer = await part.toBuffer();
    const image = await this.images.addFile(
      request.params.id,
      buffer,
      part.mimetype,
    );
    return ok(
      {
        id: image.id,
        url: image.image_url,
        publicId: image.public_id ?? "",
        isPrimary: image.is_primary,
        sortOrder: image.sort_order,
      },
      "Product image added",
    );
  };

  updateImage = async (
    request: FastifyRequest<{
      Params: IdParams & { imageId: number };
      Body: ProductImageUpdateBody;
    }>,
  ) => {
    const image = await this.images.update(
      request.params.id,
      request.params.imageId,
      request.body,
    );
    return ok(
      {
        id: image.id,
        url: image.image_url,
        publicId: image.public_id ?? "",
        isPrimary: image.is_primary,
        sortOrder: image.sort_order,
      },
      "Product image updated",
    );
  };

  removeImage = async (
    request: FastifyRequest<{ Params: IdParams & { imageId: number } }>,
  ) => {
    await this.images.remove(request.params.id, request.params.imageId);
    return ok(null, "Product image deleted");
  };
}

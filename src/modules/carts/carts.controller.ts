import type { FastifyRequest } from "fastify";
import { ok } from "../../common/utils/response.js";
import { currentUser } from "../../plugins/auth.js";
import type {
  AddCartItemBody,
  ProductIdParams,
  SetCartItemBody,
} from "./carts.schema.js";
import type { CartsService } from "./carts.service.js";

export class CartsController {
  constructor(private readonly service: CartsService) {}

  get = async (request: FastifyRequest) =>
    ok(await this.service.get(currentUser(request).id));

  add = async (request: FastifyRequest<{ Body: AddCartItemBody }>) =>
    ok(
      await this.service.addItem(
        currentUser(request).id,
        request.body.productId,
        request.body.quantity,
      ),
      "Added to cart",
    );

  setQuantity = async (
    request: FastifyRequest<{ Params: ProductIdParams; Body: SetCartItemBody }>,
  ) =>
    ok(
      await this.service.setItem(
        currentUser(request).id,
        request.params.productId,
        request.body.quantity,
      ),
      "Cart updated",
    );

  remove = async (request: FastifyRequest<{ Params: ProductIdParams }>) =>
    ok(
      await this.service.removeItem(
        currentUser(request).id,
        request.params.productId,
      ),
      "Removed from cart",
    );

  clear = async (request: FastifyRequest) =>
    ok(await this.service.clear(currentUser(request).id), "Cart cleared");
}

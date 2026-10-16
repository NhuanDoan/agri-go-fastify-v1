import type { FastifyReply, FastifyRequest } from "fastify";
import type { IdParams } from "../../common/schemas/common.js";
import { buildMeta } from "../../common/utils/pagination.js";
import { ok, paginated } from "../../common/utils/response.js";
import { currentUser } from "../../plugins/auth.js";
import type {
  CreateUserBody,
  ListUsersQuery,
  UpdateProfileBody,
  UpdateUserBody,
} from "./users.schema.js";
import { toUserDto } from "./users.serializer.js";
import type { UsersService } from "./users.service.js";

/** HTTP edge only: unpack the request, call the service, shape the envelope. */
export class UsersController {
  constructor(private readonly service: UsersService) {}

  list = async (request: FastifyRequest<{ Querystring: ListUsersQuery }>) => {
    const { items, total } = await this.service.list(request.query);
    return paginated(
      items.map(toUserDto),
      buildMeta(request.query.page, request.query.perPage, total),
    );
  };

  get = async (request: FastifyRequest<{ Params: IdParams }>) =>
    ok(toUserDto(await this.service.getById(request.params.id)));

  create = async (
    request: FastifyRequest<{ Body: CreateUserBody }>,
    reply: FastifyReply,
  ) => {
    const user = await this.service.create(request.body);
    reply.code(201);
    return ok(toUserDto(user), "User created");
  };

  update = async (
    request: FastifyRequest<{ Params: IdParams; Body: UpdateUserBody }>,
  ) =>
    ok(
      toUserDto(
        await this.service.update(
          request.params.id,
          request.body,
          currentUser(request).id,
        ),
      ),
      "User updated",
    );

  remove = async (request: FastifyRequest<{ Params: IdParams }>) => {
    await this.service.remove(request.params.id, currentUser(request).id);
    return ok(null, "User deleted");
  };

  me = async (request: FastifyRequest) =>
    ok(toUserDto(await this.service.getById(currentUser(request).id)));

  updateMe = async (request: FastifyRequest<{ Body: UpdateProfileBody }>) =>
    ok(
      toUserDto(
        await this.service.updateProfile(currentUser(request).id, request.body),
      ),
      "Profile updated",
    );
}

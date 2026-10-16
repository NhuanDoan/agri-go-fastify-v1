import type { FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import {
  ForbiddenError,
  UnauthorizedError,
} from "../common/errors/app-error.js";
import {
  TokenService,
  type AuthUser,
} from "../common/security/token.service.js";
import type { UserRole } from "../modules/users/users.types.js";

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

/** For controllers behind `authenticate`: the verified identity of this request. */
export function currentUser(request: FastifyRequest): AuthUser {
  if (!request.user) throw new UnauthorizedError();
  return request.user;
}

export default fp(
  async (app) => {
    const { config } = app;
    const tokens = new TokenService({
      accessSecret: config.JWT_ACCESS_SECRET,
      refreshSecret: config.JWT_REFRESH_SECRET,
      accessTtlSeconds: config.JWT_ACCESS_TTL_SECONDS,
      refreshTtlSeconds: config.JWT_REFRESH_TTL_SECONDS,
    });

    app.decorate("tokens", tokens);
    app.decorateRequest("user", null);

    // preHandler: requires a valid access token
    app.decorate("authenticate", async (request: FastifyRequest) => {
      const token = bearerToken(request);
      if (!token) throw new UnauthorizedError("Missing bearer token");
      request.user = tokens.verifyAccess(token);
    });

    // preHandler for public routes that behave differently when the caller is known.
    // A token that IS sent but is invalid/expired still gives 401, so clients know to refresh.
    app.decorate("optionalAuthenticate", async (request: FastifyRequest) => {
      const token = bearerToken(request);
      if (token) request.user = tokens.verifyAccess(token);
    });

    // preHandler factory: use AFTER authenticate, e.g. [app.authenticate, app.authorize('admin')]
    app.decorate(
      "authorize",
      (...roles: UserRole[]) =>
        async (request: FastifyRequest) => {
          if (!roles.includes(currentUser(request).role)) {
            throw new ForbiddenError(
              "You do not have permission to perform this action",
            );
          }
        },
    );
  },
  { name: "auth" },
);

import "fastify";
import type { Knex } from "knex";
import type {
  AuthUser,
  TokenService,
} from "../common/security/token.service.js";
import type { AppConfig } from "../config/env.js";
import type { Services } from "../container.js";
import type { MailService } from "../modules/mail/mail.service.js";
import type { UserRole } from "../modules/users/users.types.js";

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
    knex: Knex;
    tokens: TokenService;
    services: Services;
    mail: MailService;
    authenticate: (request: FastifyRequest) => Promise<void>;
    authorize: (
      ...roles: UserRole[]
    ) => (request: FastifyRequest) => Promise<void>;
    optionalAuthenticate: (request: FastifyRequest) => Promise<void>;
    /** true while shutting down: readiness answers 503 so the load balancer drains this instance. */
    draining: boolean;
  }
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

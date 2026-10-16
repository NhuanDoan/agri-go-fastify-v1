import type { FastifyReply, FastifyRequest } from "fastify";
import { ok } from "../../common/utils/response.js";
import { currentUser } from "../../plugins/auth.js";
import { toUserDto } from "../users/users.serializer.js";
import type {
  ChangePasswordBody,
  EmailBody,
  LoginBody,
  RefreshBody,
  RegisterBody,
  ResetPasswordBody,
  VerifyEmailBody,
} from "./auth.schema.js";
import type { AuthService, Session } from "./auth.service.js";
import type { ClientMeta } from "./auth.types.js";

const metaOf = (request: FastifyRequest): ClientMeta => ({
  userAgent: request.headers["user-agent"],
  ip: request.ip,
});

const toSessionDto = (s: Session) => ({
  user: toUserDto(s.user),
  tokens: {
    accessToken: s.accessToken,
    refreshToken: s.refreshToken,
    tokenType: "Bearer" as const,
    expiresIn: s.expiresIn,
  },
});

export class AuthController {
  constructor(private readonly service: AuthService) {}

  register = async (
    request: FastifyRequest<{ Body: RegisterBody }>,
    reply: FastifyReply,
  ) => {
    const session = await this.service.register(request.body, metaOf(request));
    reply.code(201);
    return ok(toSessionDto(session), "Registered successfully");
  };

  login = async (request: FastifyRequest<{ Body: LoginBody }>) =>
    ok(
      toSessionDto(await this.service.login(request.body, metaOf(request))),
      "Logged in",
    );

  refresh = async (request: FastifyRequest<{ Body: RefreshBody }>) =>
    ok(
      toSessionDto(
        await this.service.refresh(request.body.refreshToken, metaOf(request)),
      ),
      "Token refreshed",
    );

  logout = async (request: FastifyRequest<{ Body: RefreshBody }>) => {
    await this.service.logout(request.body.refreshToken);
    return ok(null, "Logged out");
  };

  logoutAll = async (request: FastifyRequest) => {
    await this.service.logoutAll(currentUser(request).id);
    return ok(null, "Logged out from all devices");
  };

  changePassword = async (
    request: FastifyRequest<{ Body: ChangePasswordBody }>,
  ) => {
    await this.service.changePassword(currentUser(request).id, request.body);
    return ok(null, "Password changed; please log in again");
  };
  verifyEmail = async (request: FastifyRequest<{ Body: VerifyEmailBody }>) => {
    await this.service.verifyEmail(request.body);
    return ok(null, "Email verified");
  };

  // Deliberately identical answers for known and unknown emails (no account enumeration).
  resendVerification = async (request: FastifyRequest<{ Body: EmailBody }>) => {
    await this.service.resendVerification(request.body.email);
    return ok(
      null,
      "If the account exists and is unverified, a new code has been sent",
    );
  };

  forgotPassword = async (request: FastifyRequest<{ Body: EmailBody }>) => {
    await this.service.forgotPassword(request.body.email);
    return ok(null, "If the account exists, a reset code has been sent");
  };

  resetPassword = async (
    request: FastifyRequest<{ Body: ResetPasswordBody }>,
  ) => {
    await this.service.resetPassword(request.body);
    return ok(null, "Password reset; please log in");
  };
}

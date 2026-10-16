import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
  ErrorResponse,
  bearerSecurity,
  commonErrors,
  securedErrors,
  successOf,
} from "../../common/schemas/common.js";
import { AuthController } from "./auth.controller.js";
import {
  ChangePasswordBody,
  EmailBody,
  LoginBody,
  RefreshBody,
  RegisterBody,
  ResetPasswordBody,
  SessionSchema,
  VerifyEmailBody,
} from "./auth.schema.js";

/** Registered under /api/auth. */
const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const controller = new AuthController(app.services.auth);
  const tags = ["Auth"];
  // brute-force protection: far tighter than the global limit
  const strict = {
    rateLimit: { max: app.config.AUTH_RATE_LIMIT_MAX, timeWindow: "1 minute" },
  };

  app.post(
    "/register",
    {
      config: strict,
      schema: {
        tags,
        summary: "Create a customer account",
        body: RegisterBody,
        response: {
          201: successOf(SessionSchema),
          409: ErrorResponse,
          ...commonErrors,
        },
      },
    },
    controller.register,
  );

  app.post(
    "/login",
    {
      config: strict,
      schema: {
        tags,
        summary: "Log in with email and password",
        body: LoginBody,
        response: {
          200: successOf(SessionSchema),
          401: ErrorResponse,
          403: ErrorResponse,
          ...commonErrors,
        },
      },
    },
    controller.login,
  );

  app.post(
    "/refresh",
    {
      config: strict,
      schema: {
        tags,
        summary: "Rotate the refresh token and get a new access token",
        description:
          "The old refresh token is revoked. Reusing an already-rotated token revokes the whole session.",
        body: RefreshBody,
        response: {
          200: successOf(SessionSchema),
          401: ErrorResponse,
          ...commonErrors,
        },
      },
    },
    controller.refresh,
  );

  app.post(
    "/logout",
    {
      schema: {
        tags,
        summary: "Revoke the session that owns this refresh token",
        body: RefreshBody,
        response: { 200: successOf(Type.Null()), ...commonErrors },
      },
    },
    controller.logout,
  );

  app.post(
    "/logout-all",
    {
      preHandler: [app.authenticate],
      schema: {
        tags,
        summary: "Revoke every session of the current user",
        security: bearerSecurity,
        response: { 200: successOf(Type.Null()), ...securedErrors },
      },
    },
    controller.logoutAll,
  );

  app.put(
    "/password",
    {
      preHandler: [app.authenticate],
      schema: {
        tags,
        summary: "Change password (signs out everywhere)",
        security: bearerSecurity,
        body: ChangePasswordBody,
        response: { 200: successOf(Type.Null()), ...securedErrors },
      },
    },
    controller.changePassword,
  );
  app.post(
    "/verify-email",
    {
      config: strict,
      schema: {
        tags,
        summary:
          "Confirm the e-mail address with the 6-digit code that was mailed",
        body: VerifyEmailBody,
        response: { 200: successOf(Type.Null()), ...commonErrors },
      },
    },
    controller.verifyEmail,
  );

  app.post(
    "/resend-verification",
    {
      config: strict,
      schema: {
        tags,
        summary: "Mail a fresh verification code (resend cool-down applies)",
        body: EmailBody,
        response: { 200: successOf(Type.Null()), ...commonErrors },
      },
    },
    controller.resendVerification,
  );

  app.post(
    "/forgot-password",
    {
      config: strict,
      schema: {
        tags,
        summary: "Mail a password-reset code",
        description: "Always answers 200, whether or not the account exists.",
        body: EmailBody,
        response: { 200: successOf(Type.Null()), ...commonErrors },
      },
    },
    controller.forgotPassword,
  );

  app.post(
    "/reset-password",
    {
      config: strict,
      schema: {
        tags,
        summary:
          "Set a new password with the mailed code (signs out everywhere)",
        body: ResetPasswordBody,
        response: { 200: successOf(Type.Null()), ...commonErrors },
      },
    },
    controller.resetPassword,
  );
};

export default authRoutes;

import type { FastifyError, FastifyInstance } from "fastify";
import { AppError } from "./app-error.js";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      success: false,
      message: `Route ${request.method} ${request.url} not found`,
      requestId: request.id,
    });
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const requestId = request.id; // also in the logs: lets support find the exact failure

    // 1. errors we throw on purpose
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send({
          success: false,
          message: error.message,
          code: error.errorCode,
          errors: error.details,
          requestId,
        });
    }

    // 2. schema validation failures -> 422 with one entry per bad field
    if (error.validation) {
      const errors = error.validation.map((v) => {
        const path = v.instancePath.replace(/^\//, "").replace(/\//g, ".");
        const missing =
          typeof v.params?.missingProperty === "string"
            ? v.params.missingProperty
            : undefined;
        return {
          in: error.validationContext, // body | querystring | params | headers
          field: [path, missing].filter(Boolean).join(".") || null,
          message: v.message ?? "Invalid value",
        };
      });
      return reply.status(422).send({
        success: false,
        message: "Validation failed",
        errors,
        requestId,
      });
    }

    // 3. PostgreSQL constraint violations that slipped past our own checks (e.g. two requests racing)
    const pgCode = (error as { code?: string }).code;
    if (pgCode === "23505")
      return reply.status(409).send({
        success: false,
        message: "Resource already exists",
        requestId,
      });
    if (pgCode === "23503") {
      return reply.status(409).send({
        success: false,
        message: "Operation conflicts with related data",
        requestId,
      });
    }
    if (pgCode === "23514") {
      return reply.status(422).send({
        success: false,
        message: "Value violates a database constraint",
        requestId,
      });
    }

    // 4. everything else: 4xx from Fastify itself (bad JSON, 413, ...) keep their message,
    //    anything unexpected becomes a generic 500 so internals never leak
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, "Unhandled error");
      return reply
        .status(500)
        .send({ success: false, message: "Internal server error", requestId });
    }
    return reply
      .status(status)
      .send({ success: false, message: error.message, requestId });
  });
}

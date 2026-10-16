export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: unknown,
    /** Stable identifier a frontend can switch on (messages may be reworded or translated). */
    readonly errorCode?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request", details?: unknown) {
    super(400, message, details);
  }
}
export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, message);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", errorCode?: string) {
    super(403, message, undefined, errorCode);
  }
}
export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(404, message);
  }
}
export class ConflictError extends AppError {
  constructor(message = "Conflict", details?: unknown) {
    super(409, message, details);
  }
}
export class UnprocessableError extends AppError {
  constructor(message = "Unprocessable entity", details?: unknown) {
    super(422, message, details);
  }
}

import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../logger.js";

export class HttpError extends Error {
  public readonly code: string;
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
    code: string = "BAD_REQUEST"
  ) {
    super(message);
    this.code = code;
  }
}

export const notFound: RequestHandler = (_request, _response, next) => {
  next(new HttpError(404, "Route not found.", undefined, "NOT_FOUND"));
};

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: "Validation failed.",
      code: "VALIDATION_FAILED",
      details: error.issues
    });
    return;
  }

  if (error instanceof HttpError) {
    response.status(error.status).json({
      error: error.message,
      code: error.code,
      details: error.details
    });
    return;
  }

  const databaseError = error as { code?: string };
  if (databaseError.code === "23505") {
    response.status(409).json({
      error: "A record with those values already exists.",
      code: "CONFLICT"
    });
    return;
  }

  logger.error({ error, method: request.method, path: request.path }, "Unhandled request error");
  response.status(500).json({
    error: "An unexpected server error occurred.",
    code: "INTERNAL_SERVER_ERROR"
  });
};

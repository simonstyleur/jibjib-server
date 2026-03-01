import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import multer from "multer";
import { logger } from "../utils/logger";

export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    status: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;

    // Restore prototype chain (needed when extending builtins in TS)
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Known application error
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        status: err.status,
        ...(err.details && { details: err.details }),
      },
    });
    return;
  }

  // Zod validation error
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const path = issue.path.join(".") || "_root";
      if (!fieldErrors[path]) {
        fieldErrors[path] = [];
      }
      fieldErrors[path].push(issue.message);
    }

    res.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        status: 422,
        details: fieldErrors,
      },
    });
    return;
  }

  // Express JSON body-parser SyntaxError (malformed JSON)
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "Malformed JSON in request body",
        status: 400,
      },
    });
    return;
  }

  // Multer file upload error
  if (err instanceof multer.MulterError) {
    const messages: Record<string, string> = {
      LIMIT_FILE_SIZE: "File is too large",
      LIMIT_UNEXPECTED_FILE: "Unexpected file field",
      LIMIT_FILE_COUNT: "Too many files",
    };

    res.status(400).json({
      error: {
        code: "UPLOAD_ERROR",
        message: messages[err.code] ?? `Upload error: ${err.message}`,
        status: 400,
      },
    });
    return;
  }

  // Unknown / unexpected error
  logger.error({ err }, "Unhandled error");

  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      status: 500,
    },
  });
}

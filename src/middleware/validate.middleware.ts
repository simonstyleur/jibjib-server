import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";

/**
 * Validate req.body against a Zod schema.
 * On success, assigns the parsed (and potentially transformed) value back to req.body.
 * On failure, passes the ZodError to the error handler.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Validate req.query against a Zod schema.
 * On success, assigns the parsed value back to req.query.
 * On failure, passes the ZodError to the error handler.
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      (req as any).query = schema.parse(req.query);
      next();
    } catch (err) {
      next(err);
    }
  };
}

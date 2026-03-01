import { Request, Response, NextFunction } from "express";
import { AppError } from "./error.middleware";

/**
 * Middleware that requires the authenticated user to be part of a pair.
 * Must be used after the `authenticate` middleware which sets req.pairId.
 */
export function requirePair(req: Request, _res: Response, next: NextFunction): void {
  if (!req.pairId) {
    next(new AppError(
      "FORBIDDEN",
      403,
      "You need to be paired to access this resource.",
    ));
    return;
  }
  next();
}

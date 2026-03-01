import { Request, Response, NextFunction } from "express";
import { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";
import { verifyAccessToken } from "../utils/jwt";
import { findUserById } from "../db/queries/user.queries";
import { findActivePairByUserId } from "../db/queries/pair.queries";
import { AppError } from "./error.middleware";

/**
 * Express middleware that authenticates requests via Bearer JWT.
 *
 * 1. Extracts the access token from the Authorization header.
 * 2. Verifies the JWT signature and checks expiry.
 * 3. Loads the user from the database and attaches it to `req.user`.
 * 4. Looks up the user's active pair and attaches the pair ID to `req.pairId`.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // 1. Extract token from "Authorization: Bearer <token>"
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError("UNAUTHORIZED", 401, "Missing or malformed authorization header");
    }

    const token = authHeader.slice(7); // strip "Bearer "

    // 2. Verify JWT
    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        throw new AppError("TOKEN_EXPIRED", 401, "Access token has expired");
      }
      if (err instanceof JsonWebTokenError) {
        throw new AppError("UNAUTHORIZED", 401, "Invalid access token");
      }
      throw err;
    }

    // 3. Load user from DB
    const user = await findUserById(payload.userId);
    if (!user) {
      throw new AppError("UNAUTHORIZED", 401, "User not found");
    }

    req.user = user;

    // 4. Load active pair (if any) and attach pairId
    const pair = await findActivePairByUserId(user.id);
    if (pair) {
      req.pairId = pair.id;
    }

    next();
  } catch (err) {
    next(err);
  }
}

import jwt from "jsonwebtoken";
import crypto from "crypto";
import { config } from "../config";
import {
  ACCESS_TOKEN_EXPIRY_MINUTES,
  REFRESH_TOKEN_EXPIRY_DAYS,
} from "../constants/limits";

export interface TokenPayload {
  userId: string;
  type: "access" | "refresh";
}

/**
 * Sign an access token for the given user ID.
 * Includes a unique jti to prevent duplicate tokens.
 */
export function signAccessToken(userId: string): string {
  const payload: TokenPayload = { userId, type: "access" };
  return jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: `${ACCESS_TOKEN_EXPIRY_MINUTES}m`,
    jwtid: crypto.randomUUID(),
  });
}

/**
 * Sign a refresh token for the given user ID.
 * Includes a unique jti to prevent duplicate tokens.
 */
export function signRefreshToken(userId: string): string {
  const payload: TokenPayload = { userId, type: "refresh" };
  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: `${REFRESH_TOKEN_EXPIRY_DAYS}d`,
    jwtid: crypto.randomUUID(),
  });
}

/**
 * Verify and decode an access token. Throws on invalid/expired tokens.
 */
export function verifyAccessToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, config.jwt.accessSecret) as TokenPayload;
  if (decoded.type !== "access") {
    throw new jwt.JsonWebTokenError("Invalid token type: expected access");
  }
  return decoded;
}

/**
 * Verify and decode a refresh token. Throws on invalid/expired tokens.
 */
export function verifyRefreshToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, config.jwt.refreshSecret) as TokenPayload;
  if (decoded.type !== "refresh") {
    throw new jwt.JsonWebTokenError("Invalid token type: expected refresh");
  }
  return decoded;
}

/**
 * Generate a complete token pair (access + refresh) for the given user ID.
 */
export function generateTokenPair(userId: string) {
  const now = new Date();

  const accessExpiresAt = new Date(
    now.getTime() + ACCESS_TOKEN_EXPIRY_MINUTES * 60 * 1000,
  );
  const refreshExpiresAt = new Date(
    now.getTime() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  );

  return {
    access_token: signAccessToken(userId),
    refresh_token: signRefreshToken(userId),
    access_expires_at: accessExpiresAt.toISOString(),
    refresh_expires_at: refreshExpiresAt.toISOString(),
  };
}

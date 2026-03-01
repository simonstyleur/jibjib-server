import { query } from "../db/pool";
import { createUser } from "../db/queries/user.queries";
import {
  generateTokenPair,
  verifyRefreshToken,
} from "../utils/jwt";
import { REFRESH_TOKEN_EXPIRY_DAYS } from "../constants/limits";
import { AppError } from "../middleware/error.middleware";
import { logger } from "../utils/logger";
import type { User } from "../types";
import type { AnonymousInput } from "../validators/auth.schema";

interface SessionRow {
  id: string;
  user_id: string;
  refresh_token: string;
  device_id: string;
  device_name: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

interface TokenPair {
  access_token: string;
  refresh_token: string;
  access_expires_at: string;
  refresh_expires_at: string;
}

// ─── Session helper ──────────────────────────────────────────────────────────

/**
 * Insert a new session record into the sessions table.
 */
async function createSession(
  userId: string,
  refreshToken: string,
  deviceId: string,
  expiresAt: Date,
): Promise<void> {
  await query(
    `INSERT INTO sessions (user_id, refresh_token, device_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, refreshToken, deviceId, expiresAt.toISOString()],
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Create an anonymous user account, generate a token pair, and persist a
 * session row.  Returns the created user and tokens.
 */
export async function createAnonymousUser(
  data: AnonymousInput,
): Promise<{ user: User; tokens: TokenPair }> {
  const user = await createUser({
    name: data.name,
    language: data.language,
    auth_provider: "anonymous",
    device_os: data.device_os,
    app_version: data.app_version,
    onesignal_player_id: data.onesignal_player_id,
  });

  const tokens = generateTokenPair(user.id);

  const refreshExpiresAt = new Date(
    Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  );

  await createSession(
    user.id,
    tokens.refresh_token,
    data.device_id,
    refreshExpiresAt,
  );

  logger.info({ userId: user.id }, "Anonymous user created");

  return { user, tokens };
}

/**
 * Rotate refresh tokens.  Verifies the incoming JWT, finds the matching active
 * session, revokes it, and issues a brand-new token pair with a fresh session.
 */
export async function refreshTokens(
  refreshToken: string,
): Promise<{ tokens: TokenPair }> {
  // 1. Verify JWT signature & expiry
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError("TOKEN_EXPIRED", 401, "Refresh token is invalid or expired");
  }

  // 2. Find the active (non-revoked) session in DB
  const sessionResult = await query<SessionRow>(
    `SELECT * FROM sessions
     WHERE refresh_token = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()
     LIMIT 1`,
    [refreshToken],
  );

  if (sessionResult.rows.length === 0) {
    throw new AppError("TOKEN_EXPIRED", 401, "Session not found or already revoked");
  }

  const session = sessionResult.rows[0];

  // 3. Revoke the old session
  await query(
    `UPDATE sessions SET revoked_at = NOW() WHERE id = $1`,
    [session.id],
  );

  // 4. Issue new token pair
  const tokens = generateTokenPair(payload.userId);

  const refreshExpiresAt = new Date(
    Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  );

  // 5. Persist new session
  await createSession(
    payload.userId,
    tokens.refresh_token,
    session.device_id,
    refreshExpiresAt,
  );

  logger.info({ userId: payload.userId }, "Tokens refreshed");

  return { tokens };
}

/**
 * Logout: revoke the session identified by the given refresh token.
 */
export async function logout(
  refreshToken: string,
  _deviceId: string,
): Promise<void> {
  const result = await query(
    `UPDATE sessions
     SET revoked_at = NOW()
     WHERE refresh_token = $1
       AND revoked_at IS NULL`,
    [refreshToken],
  );

  if (result.rowCount === 0) {
    logger.warn("Logout called with unknown or already-revoked refresh token");
  }
}

import { query } from "../db/pool";
import { createUser, findUserByAuth, linkAuthProvider } from "../db/queries/user.queries";
import { createPair, findActivePairByUserId } from "../db/queries/pair.queries";
import { createList, findListsByPairId } from "../db/queries/list.queries";
import {
  generateTokenPair,
  verifyRefreshToken,
} from "../utils/jwt";
import { verifyAppleIdentityToken } from "./apple-auth.service";
import { REFRESH_TOKEN_EXPIRY_DAYS } from "../constants/limits";
import { AppError } from "../middleware/error.middleware";
import { logger } from "../utils/logger";
import type { User } from "../types";
import type { AnonymousInput, SocialInput, LinkInput } from "../validators/auth.schema";

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
): Promise<{ user: User; tokens: TokenPair; pair: { id: string }; list: { id: string; name: string; is_active: boolean } }> {
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

  // Create a solo pair + default list so the user can start adding items immediately
  const pair = await createPair(user.id);
  const list = await createList(pair.id);

  logger.info({ userId: user.id, pairId: pair.id, listId: list.id }, "Anonymous user created with default list");

  return { user, tokens, pair, list };
}

/**
 * Social login. Verifies the provider identity token, finds or creates the user
 * keyed by (provider, sub), and issues a token pair. Returning users reuse their
 * existing pair + active list; first-time users get a solo pair + default list
 * (mirrors anonymous sign-up). Currently Apple only; other providers 501 until
 * their OAuth client is configured.
 */
export async function loginWithSocial(
  data: SocialInput,
): Promise<{ user: User; tokens: TokenPair; pair: { id: string }; list: { id: string; name: string; is_active: boolean } }> {
  if (data.provider !== "apple") {
    throw new AppError(
      "NOT_IMPLEMENTED",
      501,
      `${data.provider} sign-in is not yet available.`,
    );
  }

  const { sub } = await verifyAppleIdentityToken(data.id_token);

  let user = await findUserByAuth("apple", sub);
  let pairId: string;
  let list: { id: string; name: string; is_active: boolean };

  if (user) {
    // Returning user — reuse their existing pair + active list.
    const pair = await findActivePairByUserId(user.id);
    if (pair) {
      pairId = pair.id;
      const lists = await findListsByPairId(pair.id);
      const active = lists.find((l) => l.is_active) ?? lists[0];
      list = active ?? (await createList(pair.id));
    } else {
      const newPair = await createPair(user.id);
      pairId = newPair.id;
      list = await createList(newPair.id);
    }
  } else {
    // First sign-in — create the account, a solo pair, and a default list.
    user = await createUser({
      name: data.name?.trim() || "Friend",
      language: "en",
      auth_provider: "apple",
      auth_id: sub,
      device_os: data.device_os,
      app_version: data.app_version,
    });
    const pair = await createPair(user.id);
    pairId = pair.id;
    list = await createList(pair.id);
  }

  const tokens = generateTokenPair(user.id);
  const refreshExpiresAt = new Date(
    Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  );
  await createSession(user.id, tokens.refresh_token, data.device_id, refreshExpiresAt);

  logger.info({ userId: user.id, provider: data.provider }, "Social user logged in");

  return {
    user,
    tokens,
    pair: { id: pairId },
    list: { id: list.id, name: list.name, is_active: list.is_active },
  };
}

/**
 * Link a social provider to the currently-authenticated (typically anonymous)
 * user, so they can recover this account after a reinstall. Fails with 409 if
 * the social identity is already attached to a different account.
 */
export async function linkSocialAccount(
  userId: string,
  data: LinkInput,
): Promise<User> {
  if (data.provider !== "apple") {
    throw new AppError(
      "NOT_IMPLEMENTED",
      501,
      `${data.provider} linking is not yet available.`,
    );
  }

  const { sub } = await verifyAppleIdentityToken(data.id_token);

  const existing = await findUserByAuth("apple", sub);
  if (existing && existing.id !== userId) {
    throw new AppError(
      "ALREADY_LINKED",
      409,
      "This Apple ID is already linked to another account.",
    );
  }
  if (existing && existing.id === userId) {
    // Already linked to this account — no-op.
    return existing;
  }

  const updated = await linkAuthProvider(userId, "apple", sub);
  if (!updated) {
    throw new AppError("NOT_FOUND", 404, "User not found.");
  }
  return updated;
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
 * Revoke every active session for a user (used on account deletion so all
 * devices are signed out immediately).
 */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await query(
    `UPDATE sessions
     SET revoked_at = NOW()
     WHERE user_id = $1
       AND revoked_at IS NULL`,
    [userId],
  );
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

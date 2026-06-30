import { query } from "../pool";
import type { User } from "../../types";

interface CreateUserData {
  name: string;
  language: "en" | "fr" | "ar";
  auth_provider: "anonymous" | "google" | "apple" | "facebook";
  auth_id?: string;
  device_os?: string;
  app_version?: string;
  onesignal_player_id?: string;
}

interface UserRow {
  id: string;
  name: string;
  avatar_url: string | null;
  language: "en" | "fr" | "ar";
  auth_provider: "anonymous" | "google" | "apple" | "facebook" | null;
  auth_id: string | null;
  onesignal_player_id: string | null;
  device_os: string | null;
  app_version: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
  last_active_at: string | null;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    avatar_url: row.avatar_url,
    language: row.language,
    auth_provider: row.auth_provider,
    onesignal_player_id: row.onesignal_player_id,
    created_at: row.created_at,
  };
}

/**
 * Insert a new user and return the full user row.
 */
export async function createUser(data: CreateUserData): Promise<User> {
  const result = await query<UserRow>(
    `INSERT INTO users (name, language, auth_provider, auth_id, device_os, app_version, onesignal_player_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.name,
      data.language,
      data.auth_provider,
      data.auth_id ?? null,
      data.device_os ?? null,
      data.app_version ?? null,
      data.onesignal_player_id ?? null,
    ],
  );

  return toUser(result.rows[0]);
}

/**
 * Find a user by their UUID. Returns null if not found.
 */
export async function findUserById(id: string): Promise<User | null> {
  const result = await query<UserRow>(
    `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );

  if (result.rows.length === 0) return null;
  return toUser(result.rows[0]);
}

/**
 * Find a user by auth provider and provider-specific ID.
 * Returns null if not found.
 */
export async function findUserByAuth(
  provider: string,
  authId: string,
): Promise<User | null> {
  const result = await query<UserRow>(
    `SELECT * FROM users WHERE auth_provider = $1 AND auth_id = $2 AND deleted_at IS NULL`,
    [provider, authId],
  );

  if (result.rows.length === 0) return null;
  return toUser(result.rows[0]);
}

/**
 * Dynamically update allowed user fields. Only provided fields are updated.
 * Returns the updated user.
 */
export async function updateUser(
  id: string,
  fields: Partial<
    Pick<User, "name" | "language" | "onesignal_player_id" | "avatar_url">
  >,
): Promise<User | null> {
  const allowed: (keyof typeof fields)[] = [
    "name",
    "language",
    "onesignal_player_id",
    "avatar_url",
  ];

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      setClauses.push(`${key} = $${paramIndex}`);
      values.push(fields[key]);
      paramIndex++;
    }
  }

  if (setClauses.length === 0) {
    return findUserById(id);
  }

  values.push(id);

  const result = await query<UserRow>(
    `UPDATE users SET ${setClauses.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
    values,
  );

  if (result.rows.length === 0) return null;
  return toUser(result.rows[0]);
}

/**
 * Update the user's last_active_at timestamp to NOW().
 */
export async function updateLastActive(id: string): Promise<void> {
  await query(`UPDATE users SET last_active_at = NOW() WHERE id = $1`, [id]);
}

/**
 * Attach a social auth provider to an existing (typically anonymous) user, so
 * they can recover the account after a reinstall by signing in with it.
 */
export async function linkAuthProvider(
  id: string,
  provider: "google" | "apple" | "facebook",
  authId: string,
): Promise<User | null> {
  const result = await query<UserRow>(
    `UPDATE users
     SET auth_provider = $2, auth_id = $3, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id, provider, authId],
  );
  if (result.rows.length === 0) return null;
  return toUser(result.rows[0]);
}

/**
 * Soft-delete a user: mark deleted_at and scrub personal data. The row is kept
 * so foreign keys (trips, item history) stay intact, but the user can no longer
 * authenticate (findUserById excludes deleted rows) and PII is removed. Clearing
 * auth_id frees the (auth_provider, auth_id) unique constraint so a future
 * sign-in with the same provider creates a fresh account.
 */
export async function softDeleteUser(id: string): Promise<void> {
  await query(
    `UPDATE users
     SET deleted_at = NOW(),
         name = 'Deleted user',
         avatar_url = NULL,
         auth_id = NULL,
         onesignal_player_id = NULL,
         updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
}

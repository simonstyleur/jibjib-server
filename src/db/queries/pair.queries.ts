import { query } from "../pool";

export interface PairRow {
  id: string;
  user_a_id: string;
  user_b_id: string | null;
  status: string;
  paired_at: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface PairedUserRow {
  id: string;
  name: string;
  avatar_url: string | null;
}

/**
 * Create a new pair with user_a. The pair starts in 'active' status
 * (DB enum only allows 'active' | 'archived'). user_b is NULL until pairing completes.
 */
export async function createPair(userAId: string): Promise<PairRow> {
  const result = await query<PairRow>(
    `INSERT INTO pairs (user_a_id, status)
     VALUES ($1, 'active')
     RETURNING *`,
    [userAId],
  );
  return result.rows[0];
}

/**
 * Find the active (not archived) pair for a given user.
 * The user can be either user_a or user_b.
 */
export async function findActivePairByUserId(userId: string): Promise<PairRow | null> {
  const result = await query<PairRow>(
    `SELECT * FROM pairs
     WHERE (user_a_id = $1 OR user_b_id = $1)
       AND status != 'archived'
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

/**
 * Find the paired user (partner) for a given user in a pair.
 * Returns the other user's profile info.
 */
export async function findPairedUser(
  pairId: string,
  userId: string,
): Promise<PairedUserRow | null> {
  const result = await query<PairedUserRow>(
    `SELECT u.id, u.name, u.avatar_url
     FROM pairs p
     JOIN users u ON u.id = CASE
       WHEN p.user_a_id = $2 THEN p.user_b_id
       ELSE p.user_a_id
     END
     WHERE p.id = $1
       AND p.user_b_id IS NOT NULL`,
    [pairId, userId],
  );
  return result.rows[0] ?? null;
}

/**
 * Complete a pair by setting user_b and paired_at.
 * Guarded: only fills an empty seat on a live pair, so two concurrent joiners
 * can't both "win" — the second UPDATE matches zero rows. Returns null when
 * the seat was already taken (caller maps this to PAIRING_USED).
 */
export async function completePair(
  pairId: string,
  userBId: string,
): Promise<PairRow | null> {
  const result = await query<PairRow>(
    `UPDATE pairs
     SET user_b_id = $2, paired_at = NOW()
     WHERE id = $1 AND user_b_id IS NULL AND status = 'active'
     RETURNING *`,
    [pairId, userBId],
  );
  return result.rows[0] ?? null;
}

/**
 * Archive a pair (soft-delete).
 */
export async function archivePair(pairId: string): Promise<PairRow> {
  const result = await query<PairRow>(
    `UPDATE pairs
     SET status = 'archived', archived_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [pairId],
  );
  if (!result.rows[0]) {
    throw new Error(`Pair ${pairId} not found`);
  }
  return result.rows[0];
}

/**
 * Find a pair by its ID.
 */
export async function findPairById(pairId: string): Promise<PairRow | null> {
  const result = await query<PairRow>(
    `SELECT * FROM pairs WHERE id = $1`,
    [pairId],
  );
  return result.rows[0] ?? null;
}

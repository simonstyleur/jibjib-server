import { query } from "../pool";
import { AppError } from "../../middleware/error.middleware";

export interface ListRow {
  id: string;
  pair_id: string;
  name: string;
  is_active: boolean;
  is_archived: boolean;
  item_count: number;
  checked_count: number;
  has_active_trip: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Create a new list for a pair.
 * Defaults to name "Grocery" if not provided (matches DB default).
 */
export async function createList(
  pairId: string,
  name: string = "Grocery",
): Promise<ListRow> {
  const result = await query<ListRow>(
    `INSERT INTO lists (pair_id, name)
     VALUES ($1, $2)
     RETURNING
       id, pair_id, name, is_active, is_archived,
       0 AS item_count, 0 AS checked_count, FALSE AS has_active_trip,
       created_at, updated_at`,
    [pairId, name],
  );
  return result.rows[0];
}

/**
 * Find all lists for a pair with item counts and active-trip status.
 */
export async function findListsByPairId(pairId: string): Promise<ListRow[]> {
  const result = await query<ListRow>(
    `SELECT
       l.id,
       l.pair_id,
       l.name,
       l.is_active,
       l.is_archived,
       COALESCE(ic.item_count, 0)::int AS item_count,
       COALESCE(ic.checked_count, 0)::int AS checked_count,
       EXISTS(
         SELECT 1 FROM trips t
         WHERE t.list_id = l.id AND t.status = 'active'
       ) AS has_active_trip,
       l.created_at,
       l.updated_at
     FROM lists l
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::int AS item_count,
         COUNT(*) FILTER (WHERE i.is_checked = TRUE)::int AS checked_count
       FROM items i
       WHERE i.list_id = l.id AND i.deleted_at IS NULL
     ) ic ON TRUE
     WHERE l.pair_id = $1 AND l.is_archived = FALSE
     ORDER BY l.is_active DESC, l.created_at DESC`,
    [pairId],
  );
  return result.rows;
}

/**
 * Find a single list by ID.
 * Returns null if not found.
 */
export async function findListById(listId: string): Promise<ListRow | null> {
  const result = await query<ListRow>(
    `SELECT
       l.id,
       l.pair_id,
       l.name,
       l.is_active,
       l.is_archived,
       COALESCE(ic.item_count, 0)::int AS item_count,
       COALESCE(ic.checked_count, 0)::int AS checked_count,
       EXISTS(
         SELECT 1 FROM trips t
         WHERE t.list_id = l.id AND t.status = 'active'
       ) AS has_active_trip,
       l.created_at,
       l.updated_at
     FROM lists l
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::int AS item_count,
         COUNT(*) FILTER (WHERE i.is_checked = TRUE)::int AS checked_count
       FROM items i
       WHERE i.list_id = l.id AND i.deleted_at IS NULL
     ) ic ON TRUE
     WHERE l.id = $1`,
    [listId],
  );
  return result.rows[0] ?? null;
}

/**
 * Verify that a list belongs to the given pair.
 * Throws NOT_FOUND if the list does not exist,
 * FORBIDDEN if it belongs to a different pair.
 */
export async function verifyListAccess(
  listId: string,
  pairId: string,
): Promise<ListRow> {
  const list = await findListById(listId);

  if (!list) {
    throw new AppError("NOT_FOUND", 404, "List not found");
  }

  if (list.pair_id !== pairId) {
    throw new AppError("FORBIDDEN", 403, "You do not have access to this list");
  }

  return list;
}

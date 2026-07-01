import { query } from "../pool";
import type { Trip, TripStatus } from "../../types";

interface TripRow {
  id: string;
  list_id: string;
  status: TripStatus;
  items_total: number;
  items_done: number;
  items_added_during: number;
  started_at: string;
  ended_at: string | null;
  shopper_id: string;
  shopper_name: string;
  shopper_avatar_url: string | null;
}

function rowToTrip(row: TripRow): Trip {
  const trip: Trip = {
    id: row.id,
    list_id: row.list_id,
    shopper: {
      id: row.shopper_id,
      name: row.shopper_name,
      avatar_url: row.shopper_avatar_url,
    },
    status: row.status,
    items_total: row.items_total,
    items_done: row.items_done,
    items_added_during: row.items_added_during,
    started_at: row.started_at,
  };

  if (row.ended_at) {
    trip.ended_at = row.ended_at;
    const startMs = new Date(row.started_at).getTime();
    const endMs = new Date(row.ended_at).getTime();
    trip.duration_minutes = Math.round((endMs - startMs) / 60000);
  }

  return trip;
}

/**
 * Insert a new trip and return the row.
 */
export async function createTrip(
  listId: string,
  shopperId: string,
  itemsTotal: number,
): Promise<Trip> {
  const result = await query<TripRow>(
    `INSERT INTO trips (list_id, shopper_id, items_total)
     VALUES ($1, $2, $3)
     RETURNING
       id,
       list_id,
       status,
       items_total,
       items_done,
       items_added_during,
       started_at,
       ended_at,
       shopper_id,
       (SELECT name FROM users WHERE id = $2) AS shopper_name,
       (SELECT avatar_url FROM users WHERE id = $2) AS shopper_avatar_url`,
    [listId, shopperId, itemsTotal],
  );
  return rowToTrip(result.rows[0]);
}

/**
 * Find the currently active trip for a list (at most one due to unique index).
 */
export async function findActiveTrip(listId: string): Promise<Trip | null> {
  const result = await query<TripRow>(
    `SELECT
       t.id,
       t.list_id,
       t.status,
       t.items_total,
       t.items_done,
       t.items_added_during,
       t.started_at,
       t.ended_at,
       u.id AS shopper_id,
       u.name AS shopper_name,
       u.avatar_url AS shopper_avatar_url
     FROM trips t
     JOIN users u ON u.id = t.shopper_id
     WHERE t.list_id = $1
       AND t.status = 'active'
     LIMIT 1`,
    [listId],
  );
  return result.rows[0] ? rowToTrip(result.rows[0]) : null;
}

/**
 * Find a trip by its ID with shopper info.
 */
export async function findTripById(tripId: string): Promise<Trip | null> {
  const result = await query<TripRow>(
    `SELECT
       t.id,
       t.list_id,
       t.status,
       t.items_total,
       t.items_done,
       t.items_added_during,
       t.started_at,
       t.ended_at,
       u.id AS shopper_id,
       u.name AS shopper_name,
       u.avatar_url AS shopper_avatar_url
     FROM trips t
     JOIN users u ON u.id = t.shopper_id
     WHERE t.id = $1`,
    [tripId],
  );
  return result.rows[0] ? rowToTrip(result.rows[0]) : null;
}

/**
 * End a trip by setting its status and ended_at timestamp.
 */
export async function endTrip(
  tripId: string,
  status: TripStatus = "completed",
): Promise<Trip> {
  const result = await query<TripRow>(
    `UPDATE trips t
     SET status = $2,
         ended_at = NOW(),
         -- Keep items_done <= items_total + items_added_during (chk_items): if
         -- more items were bought than tracked (e.g. one added mid-trip without
         -- the counter bumping), raise items_total to cover them.
         items_total = GREATEST(t.items_total, t.items_done - t.items_added_during)
     FROM users u
     WHERE t.id = $1 AND u.id = t.shopper_id
     RETURNING
       t.id,
       t.list_id,
       t.status,
       t.items_total,
       t.items_done,
       t.items_added_during,
       t.started_at,
       t.ended_at,
       u.id AS shopper_id,
       u.name AS shopper_name,
       u.avatar_url AS shopper_avatar_url`,
    [tripId, status],
  );
  if (!result.rows[0]) {
    throw new Error(`Trip ${tripId} not found`);
  }
  return rowToTrip(result.rows[0]);
}

/**
 * Bump items_added_during for the active trip on a list. No-op if there is no
 * active trip (0 rows). Keeps the trip's counts consistent when items are added
 * mid-trip so items_done can legitimately exceed the original items_total.
 */
export async function incrementItemsAddedDuring(
  listId: string,
  count: number,
): Promise<void> {
  await query(
    `UPDATE trips
     SET items_added_during = items_added_during + $2
     WHERE list_id = $1 AND status = 'active'`,
    [listId, count],
  );
}

/**
 * Update trip progress counters.
 */
export async function updateTripProgress(
  tripId: string,
  itemsDone: number,
  itemsAddedDuring: number,
): Promise<void> {
  await query(
    `UPDATE trips
     SET items_done = $2, items_added_during = $3
     WHERE id = $1`,
    [tripId, itemsDone, itemsAddedDuring],
  );
}

/**
 * Find unchecked, non-deleted items in a list (skipped items for trip summary).
 */
export async function findSkippedItems(
  listId: string,
): Promise<Array<{ id: string; name: string }>> {
  const result = await query<{ id: string; name: string }>(
    `SELECT id, name
     FROM items
     WHERE list_id = $1
       AND is_checked = false
       AND deleted_at IS NULL
     ORDER BY position ASC`,
    [listId],
  );
  return result.rows;
}

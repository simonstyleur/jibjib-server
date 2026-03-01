import { findListsByPairId, verifyListAccess } from "../db/queries/list.queries";
import { findItemsByListId } from "../db/queries/item.queries";
import { query } from "../db/pool";
import type { List, Item, Trip } from "../types";

interface ActiveTripRow {
  id: string;
  list_id: string;
  shopper_id: string;
  shopper_name: string;
  shopper_avatar_url: string | null;
  status: string;
  items_total: number;
  items_done: number;
  items_added_during: number;
  started_at: string;
}

/**
 * Get all lists for a pair with item counts and active trip info.
 */
export async function getListsForPair(pairId: string): Promise<List[]> {
  const rows = await findListsByPairId(pairId);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    is_active: row.is_active,
    item_count: row.item_count,
    checked_count: row.checked_count,
    has_active_trip: row.has_active_trip,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

/**
 * Get a single list with all its items and active trip info.
 * Verifies that the list belongs to the requesting pair.
 */
export async function getListWithItems(
  listId: string,
  pairId: string,
): Promise<{ list: List; items: Item[]; active_trip: Trip | null }> {
  const listRow = await verifyListAccess(listId, pairId);
  const itemRows = await findItemsByListId(listId);

  // Fetch active trip for this list if one exists
  const tripResult = await query<ActiveTripRow>(
    `SELECT
       t.id, t.list_id, t.shopper_id,
       u.name AS shopper_name,
       u.avatar_url AS shopper_avatar_url,
       t.status, t.items_total, t.items_done,
       t.items_added_during, t.started_at
     FROM trips t
     INNER JOIN users u ON u.id = t.shopper_id
     WHERE t.list_id = $1 AND t.status = 'active'
     LIMIT 1`,
    [listId],
  );

  const activeTripRow = tripResult.rows[0] ?? null;

  const list: List = {
    id: listRow.id,
    name: listRow.name,
    is_active: listRow.is_active,
    item_count: listRow.item_count,
    checked_count: listRow.checked_count,
    has_active_trip: listRow.has_active_trip,
    created_at: listRow.created_at,
    updated_at: listRow.updated_at,
  };

  const items: Item[] = itemRows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category as Item["category"],
    quantity: row.quantity,
    is_checked: row.is_checked,
    checked_by: row.checked_by,
    checked_at: row.checked_at,
    position: row.position,
    photo_urls: row.photo_urls,
    voice_url: row.voice_url,
    has_messages: row.has_messages,
    unread_message_count: row.unread_message_count,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  const active_trip: Trip | null = activeTripRow
    ? {
        id: activeTripRow.id,
        list_id: activeTripRow.list_id,
        shopper: {
          id: activeTripRow.shopper_id,
          name: activeTripRow.shopper_name,
          avatar_url: activeTripRow.shopper_avatar_url,
        },
        status: activeTripRow.status as Trip["status"],
        items_total: activeTripRow.items_total,
        items_done: activeTripRow.items_done,
        items_added_during: activeTripRow.items_added_during,
        started_at: activeTripRow.started_at,
      }
    : null;

  return { list, items, active_trip };
}

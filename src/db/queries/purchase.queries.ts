import { pool } from "../pool";

/**
 * The purchase log: what was actually bought, on which trip, for how much.
 *
 * Separate from `items` because `items` is the live list — unchecked rows carry
 * over between shops, so a price stored there would be overwritten every trip
 * and no history could exist. These rows are immutable facts about a shop that
 * happened.
 */

export interface TripItemRow {
  id: string;
  trip_id: string;
  item_id: string | null;
  item_name: string;
  category: string;
  quantity: string | null;
  price_minor: number | null;
  checked_by: string | null;
  checked_at: string;
}

/**
 * Record (or re-record) an item as bought on a trip.
 *
 * Upserts on (trip_id, item_id) so unchecking and re-checking during the same
 * shop updates the row instead of logging the purchase twice. The name and
 * category are copied in rather than joined: the item may be renamed, deleted,
 * or the list cleared long after the shop, and none of that should rewrite
 * what was bought that day.
 */
export async function recordPurchase(params: {
  tripId: string;
  itemId: string;
  itemName: string;
  category: string;
  quantity: string | null;
  checkedBy: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO trip_items
       (trip_id, item_id, item_name, category, quantity, checked_by, checked_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (trip_id, item_id) DO UPDATE
       SET item_name  = EXCLUDED.item_name,
           category   = EXCLUDED.category,
           quantity   = EXCLUDED.quantity,
           checked_by = EXCLUDED.checked_by,
           checked_at = EXCLUDED.checked_at`,
    [
      params.tripId,
      params.itemId,
      params.itemName,
      params.category,
      params.quantity,
      params.checkedBy,
    ],
  );
}

/**
 * Remove a purchase when the item is unchecked during the same trip.
 *
 * Unchecking means "I did not actually buy this", so the log should not keep
 * claiming otherwise. Only affects the trip still in progress; completed trips
 * are history and are never rewritten.
 */
export async function removePurchase(tripId: string, itemId: string): Promise<void> {
  await pool.query(`DELETE FROM trip_items WHERE trip_id = $1 AND item_id = $2`, [
    tripId,
    itemId,
  ]);
}

/** Attach a price to one purchased item. */
export async function setPurchasePrice(
  tripId: string,
  itemId: string,
  priceMinor: number | null,
): Promise<void> {
  await pool.query(
    `UPDATE trip_items SET price_minor = $3 WHERE trip_id = $1 AND item_id = $2`,
    [tripId, itemId, priceMinor],
  );
}

export interface SpendBucket {
  /** ISO date of the first day of the month, e.g. 2026-09-01. */
  month: string;
  total_minor: number;
  /** Trips in the period that carry a total — the figure is built only from these. */
  priced_trips: number;
  /** All completed trips in the period, priced or not. */
  total_trips: number;
}

/**
 * Spend per month for a pair.
 *
 * Reports priced_trips alongside total_trips so the client can say "1,240 MAD
 * across 3 of 5 shops" rather than presenting a figure that quietly
 * understates. A number the user cannot trust is worse than no number.
 */
export async function getMonthlySpend(
  pairId: string,
  fromISO: string,
  toISO: string,
): Promise<SpendBucket[]> {
  const { rows } = await pool.query(
    `SELECT to_char(date_trunc('month', t.ended_at), 'YYYY-MM-DD') AS month,
            COALESCE(SUM(t.total_minor), 0)::int                   AS total_minor,
            COUNT(t.total_minor)::int                              AS priced_trips,
            COUNT(*)::int                                          AS total_trips
       FROM trips t
       JOIN lists l ON l.id = t.list_id
      WHERE l.pair_id = $1
        AND t.status IN ('completed', 'auto_ended')
        AND t.ended_at >= $2
        AND t.ended_at <  $3
      GROUP BY 1
      ORDER BY 1 DESC`,
    [pairId, fromISO, toISO],
  );
  return rows as SpendBucket[];
}

/** Per-shopper split for a period — whose spending, not just how much. */
export async function getSpendByShopper(
  pairId: string,
  fromISO: string,
  toISO: string,
): Promise<Array<{ shopper_id: string; total_minor: number; trips: number }>> {
  const { rows } = await pool.query(
    `SELECT t.shopper_id,
            COALESCE(SUM(t.total_minor), 0)::int AS total_minor,
            COUNT(*)::int                        AS trips
       FROM trips t
       JOIN lists l ON l.id = t.list_id
      WHERE l.pair_id = $1
        AND t.status IN ('completed', 'auto_ended')
        AND t.ended_at >= $2
        AND t.ended_at <  $3
      GROUP BY t.shopper_id`,
    [pairId, fromISO, toISO],
  );
  return rows as Array<{ shopper_id: string; total_minor: number; trips: number }>;
}

/**
 * Record what a shop left behind, at the moment it ended.
 *
 * Skipped items were previously only ever derived from the live list, which
 * answers "what is still unbought now" rather than "what did that shop skip".
 * The two diverge as soon as anyone edits the list, so history needs its own
 * copy taken at the time.
 */
export async function recordSkipped(
  tripId: string,
  items: Array<{ id: string; name: string; category: string; quantity: string | null }>,
): Promise<void> {
  if (items.length === 0) return;
  const values: unknown[] = [tripId];
  const tuples = items.map((it, i) => {
    const b = i * 4;
    values.push(it.id, it.name, it.category, it.quantity);
    return `($1, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, FALSE, NOW())`;
  });
  await pool.query(
    `INSERT INTO trip_items
       (trip_id, item_id, item_name, category, quantity, was_bought, checked_at)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (trip_id, item_id) DO NOTHING`,
    values,
  );
}

export interface TripHistoryRow {
  trip_id: string;
  started_at: string;
  ended_at: string;
  shopper_id: string;
  shopper_name: string;
  shopper_avatar_url: string | null;
  items_added_during: number;
  total_minor: number | null;
  currency: string | null;
  /** Bought and skipped, distinguished by was_bought. */
  items: Array<{
    item_id: string | null;
    item_name: string;
    category: string;
    quantity: string | null;
    price_minor: number | null;
    was_bought: boolean;
  }>;
}

/**
 * Completed shops for a pair, newest first, with what each one bought and
 * skipped.
 *
 * Server-side because a shop belongs to the pair, not to a device. The
 * client's local archive only ever held trips that device happened to witness,
 * so two partners saw two different histories.
 *
 * Items are aggregated in the query rather than fetched per trip: a shop can
 * hold dozens of rows and a page of history would otherwise be a request each.
 */
export async function getTripHistory(
  pairId: string,
  limit: number,
): Promise<TripHistoryRow[]> {
  const { rows } = await pool.query(
    `SELECT t.id                    AS trip_id,
            t.started_at,
            t.ended_at,
            t.items_added_during,
            t.total_minor,
            t.currency,
            u.id                    AS shopper_id,
            u.name                  AS shopper_name,
            u.avatar_url            AS shopper_avatar_url,
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'item_id',     ti.item_id,
                        'item_name',   ti.item_name,
                        'category',    ti.category,
                        'quantity',    ti.quantity,
                        'price_minor', ti.price_minor,
                        'was_bought',  ti.was_bought
                      ) ORDER BY ti.was_bought DESC, ti.checked_at)
                 FROM trip_items ti
                WHERE ti.trip_id = t.id),
              '[]'::json
            )                       AS items
       FROM trips t
       JOIN lists l ON l.id = t.list_id
       JOIN users u ON u.id = t.shopper_id
      WHERE l.pair_id = $1
        AND t.status IN ('completed', 'auto_ended')
        AND t.ended_at IS NOT NULL
      ORDER BY t.ended_at DESC
      LIMIT $2`,
    [pairId, limit],
  );
  return rows as TripHistoryRow[];
}

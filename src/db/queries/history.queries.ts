import { query } from "../pool";

export interface ItemHistoryRow {
  id: string;
  pair_id: string;
  item_name: string;
  category: string;
  last_added_at: string;
  add_count: number;
  avg_interval_days: number | null;
}

/**
 * Find purchase history for a pair, ordered by most frequently added items.
 */
export async function findHistoryByPair(
  pairId: string,
  limit: number = 50,
): Promise<ItemHistoryRow[]> {
  const result = await query<ItemHistoryRow>(
    `SELECT id, pair_id, item_name, category, last_added_at, add_count, avg_interval_days
     FROM item_history
     WHERE pair_id = $1
     ORDER BY add_count DESC
     LIMIT $2`,
    [pairId, limit],
  );

  return result.rows;
}

/**
 * Get smart suggestions for a pair based on purchase frequency patterns.
 *
 * Items are ranked by how "due" they are: items with a high add_count
 * and whose avg_interval_days is close to or less than the time elapsed
 * since last_added_at are prioritized.
 *
 * The scoring formula:
 *   score = add_count * (days_since_last_added / avg_interval_days)
 *
 * Items that have never had an interval computed (avg_interval_days IS NULL)
 * but have been added at least twice are still included with a fallback score.
 */
export async function getSmartSuggestions(
  pairId: string,
  limit: number = 10,
): Promise<ItemHistoryRow[]> {
  const result = await query<ItemHistoryRow>(
    `SELECT id, pair_id, item_name, category, last_added_at, add_count, avg_interval_days
     FROM item_history
     WHERE pair_id = $1
       AND add_count >= 2
     ORDER BY
       CASE
         WHEN avg_interval_days IS NOT NULL AND avg_interval_days > 0 THEN
           add_count * (EXTRACT(EPOCH FROM (NOW() - last_added_at)) / 86400.0 / avg_interval_days)
         ELSE
           add_count
       END DESC
     LIMIT $2`,
    [pairId, limit],
  );

  return result.rows;
}

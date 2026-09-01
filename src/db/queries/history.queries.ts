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

/**
 * Record that a price was observed for an item.
 *
 * Called when a purchase price is entered, so the price memory is a by-product
 * of shopping rather than something anyone maintains. Upserts on
 * (pair_id, item_name) — the table's existing unique key — so the first
 * observation creates the row and later ones refine it.
 *
 * avg_price_minor is a true running mean, computed from the stored average and
 * sample count rather than by re-reading the purchase log: it keeps this to one
 * statement, and the log stays the record of individual purchases while this
 * stays the summary.
 *
 * last_price_minor is kept separately because it is usually the better
 * estimator. Grocery prices drift, so what this pair paid last week beats a
 * mean stretching back two years.
 */
export async function recordObservedPrice(params: {
  pairId: string;
  itemName: string;
  category: string;
  priceMinor: number;
}): Promise<void> {
  await query(
    `INSERT INTO item_history
       (pair_id, item_name, category, last_added_at, add_count,
        last_price_minor, avg_price_minor, price_samples)
     VALUES ($1, $2, $3, NOW(), 1, $4, $4, 1)
     ON CONFLICT (pair_id, item_name) DO UPDATE
       SET last_price_minor = EXCLUDED.last_price_minor,
           avg_price_minor  = ROUND(
             ((COALESCE(item_history.avg_price_minor, 0)::numeric
                * item_history.price_samples) + EXCLUDED.last_price_minor)
             / (item_history.price_samples + 1)
           )::int,
           price_samples    = item_history.price_samples + 1,
           category         = EXCLUDED.category,
           updated_at       = NOW()`,
    [params.pairId, params.itemName.trim().toLowerCase(), params.category, params.priceMinor],
  );
}

/**
 * Set or clear a hand-entered price for an item.
 *
 * Stored apart from the observed values so clearing it falls back to what was
 * actually paid, and a single correction never destroys real history.
 */
export async function setManualPrice(
  pairId: string,
  itemName: string,
  priceMinor: number | null,
): Promise<void> {
  await query(
    `INSERT INTO item_history (pair_id, item_name, category, manual_price_minor)
     VALUES ($1, $2, 'other', $3)
     ON CONFLICT (pair_id, item_name) DO UPDATE
       SET manual_price_minor = EXCLUDED.manual_price_minor,
           updated_at         = NOW()`,
    [pairId, itemName.trim().toLowerCase(), priceMinor],
  );
}

export interface KnownPriceRow {
  item_name: string;
  /** manual if set, else last paid, else the mean. */
  price_minor: number;
  source: "manual" | "last" | "average";
  price_samples: number;
}

/**
 * The best known price for each of the given item names.
 *
 * Precedence is manual > last paid > average: an explicit figure outranks an
 * observation, and a recent observation outranks a long-run mean. Names with no
 * price at all are simply absent from the result — the caller reports coverage
 * from what is missing rather than guessing at it.
 */
export async function getKnownPrices(
  pairId: string,
  itemNames: string[],
): Promise<KnownPriceRow[]> {
  if (itemNames.length === 0) return [];
  const normalized = itemNames.map((n) => n.trim().toLowerCase());
  const result = await query<KnownPriceRow>(
    `SELECT item_name,
            COALESCE(manual_price_minor, last_price_minor, avg_price_minor) AS price_minor,
            CASE
              WHEN manual_price_minor IS NOT NULL THEN 'manual'
              WHEN last_price_minor   IS NOT NULL THEN 'last'
              ELSE 'average'
            END AS source,
            price_samples
       FROM item_history
      WHERE pair_id = $1
        AND item_name = ANY($2::text[])
        AND COALESCE(manual_price_minor, last_price_minor, avg_price_minor) IS NOT NULL`,
    [pairId, normalized],
  );
  return result.rows;
}

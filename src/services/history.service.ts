import {
  findHistoryByPair,
  getSmartSuggestions,
  getKnownPrices,
  type ItemHistoryRow,
} from "../db/queries/history.queries";
import { findPairById } from "../db/queries/pair.queries";

/**
 * Get the full purchase history for a pair.
 * Returns items ordered by frequency (most added first).
 */
export async function getHistory(pairId: string): Promise<ItemHistoryRow[]> {
  return findHistoryByPair(pairId);
}

/**
 * Get smart item suggestions for a pair based on purchase frequency patterns.
 * Uses historical add_count and avg_interval_days to predict which items
 * the pair is likely to need soon.
 */
export async function getSuggestions(pairId: string): Promise<ItemHistoryRow[]> {
  return getSmartSuggestions(pairId);
}

/**
 * Estimate what the unchecked items on a list will cost.
 *
 * Shown when a shop is about to start, which is the moment the number is
 * actually useful — it answers "do we have enough on us for this?" rather than
 * reporting after the fact.
 *
 * Reports covered/total explicitly. An estimate built from eight of twelve
 * items must say so: the first time it is badly wrong because a third of the
 * basket was invisible to it, the user stops believing any figure the app
 * shows. Partial coverage stated plainly stays useful; a bare number that
 * quietly understates does not.
 *
 * Quantity is deliberately ignored. It is a freeform string ("2x", "500g", "a
 * bunch") with no reliable parse, so "milk" carries one remembered price
 * whatever amount is written beside it. This is an approximation and the UI
 * should present it as one.
 */
export async function estimateListCost(
  pairId: string,
  items: Array<{ name: string; category: string }>,
): Promise<{
  total_minor: number;
  covered: number;
  total: number;
  currency: string | null;
  items: Array<{ name: string; price_minor: number; source: string }>;
}> {
  const [known, pair] = await Promise.all([
    getKnownPrices(pairId, items.map((i) => i.name)),
    findPairById(pairId),
  ]);

  const byName = new Map(known.map((k) => [k.item_name, k]));
  const priced: Array<{ name: string; price_minor: number; source: string }> = [];
  let total = 0;

  for (const item of items) {
    const hit = byName.get(item.name.trim().toLowerCase());
    if (!hit) continue;
    total += hit.price_minor;
    priced.push({ name: item.name, price_minor: hit.price_minor, source: hit.source });
  }

  return {
    total_minor: total,
    covered: priced.length,
    total: items.length,
    currency: (pair as { currency?: string | null } | null)?.currency ?? null,
    items: priced,
  };
}

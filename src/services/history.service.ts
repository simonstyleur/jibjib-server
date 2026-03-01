import {
  findHistoryByPair,
  getSmartSuggestions,
  type ItemHistoryRow,
} from "../db/queries/history.queries";

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

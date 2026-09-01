import type { PairedUser } from "./user";

export type TripStatus = "active" | "completed" | "auto_ended";

export interface Trip {
  id: string;
  list_id: string;
  shopper: PairedUser;
  status: TripStatus;
  items_total: number;
  items_done: number;
  items_added_during: number;
  started_at: string;
  ended_at?: string;
  duration_minutes?: number;
  /**
   * What the shop cost, in integer minor units, when a shopper recorded one.
   * Optional throughout: a trip with no total is a normal trip.
   */
  total_minor?: number;
  /** ISO 4217, stamped per trip so changing it later cannot rewrite history. */
  currency?: string;
}

export interface TripSummary extends Trip {
  ended_at: string;
  duration_minutes: number;
  skipped_items: Array<{ id: string; name: string }>;
}

import { AppError } from "../middleware/error.middleware";
import { verifyListAccess } from "../db/queries/list.queries";
import {
  createTrip as dbCreateTrip,
  findActiveTrip as dbFindActiveTrip,
  findTripById,
  endTrip as dbEndTrip,
  findSkippedItems,
} from "../db/queries/trip.queries";
import { setPurchasePrice } from "../db/queries/purchase.queries";
import { findItemById, findItemsByListId } from "../db/queries/item.queries";
import { recordObservedPrice } from "../db/queries/history.queries";
import { estimateListCost } from "./history.service";
import {
  getMonthlySpend,
  getSpendByShopper,
  type SpendBucket,
} from "../db/queries/purchase.queries";
import { findPairById } from "../db/queries/pair.queries";
import { findUserById } from "../db/queries/user.queries";
import { query } from "../db/pool";
import { emitToPair } from "../socket/emitter";
import { WS_EVENTS } from "../constants/events";
import { sendPushNotification } from "./notification.service";
import { logger } from "../utils/logger";
import type { Trip, TripSummary } from "../types";

/**
 * Start a new shopping trip for a list.
 * Verifies list access, checks no active trip exists, counts unchecked items,
 * creates the trip, and emits TRIP_STARTED.
 */
export async function startTrip(
  listId: string,
  pairId: string,
  userId: string,
): Promise<Trip> {
  // Verify the list belongs to this pair
  await verifyListAccess(listId, pairId);

  // Check no active trip already exists for this list
  const existingTrip = await dbFindActiveTrip(listId);
  if (existingTrip) {
    throw new AppError(
      "TRIP_ALREADY_ACTIVE",
      409,
      "There is already an active trip for this list.",
    );
  }

  // Start every trip fresh: clear any lingering checked state from a prior
  // (possibly failed or abandoned) trip, so items never show up pre-marked as
  // done. Unchecked items carry over; a new run starts with nothing checked.
  await query(
    `UPDATE items
     SET is_checked = false, checked_by = NULL, checked_at = NULL
     WHERE list_id = $1 AND is_checked = true AND deleted_at IS NULL`,
    [listId],
  );

  // Trip total = all remaining (now-unchecked) items on the list.
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM items
     WHERE list_id = $1
       AND deleted_at IS NULL`,
    [listId],
  );
  const itemsTotal = parseInt(countResult.rows[0].count, 10);

  // Create the trip
  const trip = await dbCreateTrip(listId, userId, itemsTotal);

  logger.info(
    { pairId, tripId: trip.id, shopperId: trip.shopper.id, itemsTotal },
    "Emitting TRIP_STARTED to pair room",
  );
  emitToPair(pairId, WS_EVENTS.TRIP_STARTED, { trip });

  // Send push notification to partner
  const pair = await findPairById(pairId);
  if (pair) {
    const partnerId = pair.user_a_id === userId ? pair.user_b_id : pair.user_a_id;
    if (partnerId) {
      const user = await findUserById(userId);
      sendPushNotification(
        partnerId,
        "trip_started",
        "trip_started",
        { name: user?.name, count: itemsTotal },
        { trip_id: trip.id, list_id: listId },
      );
    }
  }

  return trip;
}

/**
 * Get the active trip for a list, or null if none.
 */
export async function getActiveTrip(
  listId: string,
  pairId: string,
): Promise<Trip | null> {
  await verifyListAccess(listId, pairId);

  return dbFindActiveTrip(listId);
}

/**
 * End an active trip.
 * Verifies access, ends the trip, calculates duration, gets skipped items,
 * resets all checked items for the next trip, and emits TRIP_ENDED.
 */
export async function endTrip(
  tripId: string,
  pairId: string,
  _userId: string,
  status: "completed" | "auto_ended" = "completed",
  /**
   * Optional spend for the shop, in integer minor units, plus the currency it
   * was entered in. Stamped on the trip rather than derived from item prices:
   * a receipt includes bags, deposits and discounts, so the number the user
   * typed is the authoritative one. Currency is recorded per trip so a pair
   * that later changes it does not reinterpret its own history.
   */
  totalMinor: number | null = null,
  currency: string | null = null,
): Promise<TripSummary> {
  // Find the trip and verify it exists and is active
  const trip = await findTripById(tripId);
  if (!trip) {
    throw new AppError("NOT_FOUND", 404, "Trip not found.");
  }
  if (trip.status !== "active") {
    throw new AppError("BAD_REQUEST", 400, "Trip is not active.");
  }

  // Verify the list (and therefore the trip) belongs to this pair
  await verifyListAccess(trip.list_id, pairId);

  // End the trip
  const endedTrip = await dbEndTrip(tripId, status, totalMinor, currency);

  // Calculate duration in minutes
  const startMs = new Date(endedTrip.started_at).getTime();
  const endMs = new Date(endedTrip.ended_at!).getTime();
  const durationMinutes = Math.round((endMs - startMs) / 60000);

  // Get skipped items (unchecked items remaining)
  const skippedItems = await findSkippedItems(trip.list_id);

  // Count checked items NOW, before they get soft-deleted, so we can both
  // persist the snapshot AND surface the real count in the WS event + push.
  // Previously items_done was updated in the DB but read from the pre-update
  // endedTrip row, so the push always said "0 items bought."
  const itemsDoneResult = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM items
     WHERE list_id = $1 AND is_checked = true AND deleted_at IS NULL`,
    [trip.list_id],
  );
  const itemsDone = itemsDoneResult.rows[0]?.count ?? 0;

  // Save checked items as trip snapshot before resetting. Raise items_total if
  // needed so items_done <= items_total + items_added_during (chk_items) holds
  // even when more items were bought than the trip started with.
  await query(
    `UPDATE trips
     SET items_done = $2,
         items_total = GREATEST(items_total, $2 - items_added_during)
     WHERE id = $1`,
    [tripId, itemsDone],
  );

  // Soft-delete checked items (they've been bought — archived in trip history)
  await query(
    `UPDATE items
     SET deleted_at = NOW()
     WHERE list_id = $1
       AND is_checked = true
       AND deleted_at IS NULL`,
    [trip.list_id],
  );

  const summary: TripSummary = {
    ...endedTrip,
    ended_at: endedTrip.ended_at!,
    items_done: itemsDone,
    duration_minutes: durationMinutes,
    skipped_items: skippedItems,
  };

  logger.info(
    { pairId, tripId: summary.id, durationMinutes },
    "Emitting TRIP_ENDED to pair room",
  );
  emitToPair(pairId, WS_EVENTS.TRIP_ENDED, { trip: summary });

  // Send push notification to partner (skip for auto-ended trips — "X finished
  // shopping in 480 min" hours after the fact is noise, not news)
  const pair = status === "completed" ? await findPairById(pairId) : null;
  if (pair) {
    const partnerId = pair.user_a_id === _userId ? pair.user_b_id : pair.user_a_id;
    if (partnerId) {
      const user = await findUserById(_userId);
      sendPushNotification(
        partnerId,
        "trip_completed",
        "trip_completed",
        { name: user?.name, minutes: durationMinutes, count: summary.items_done },
        { trip_id: summary.id, list_id: trip.list_id },
      );
    }
  }

  return summary;
}

/**
 * Spend history for a pair, newest month first.
 *
 * Returns priced_trips alongside total_trips for each month so the client can
 * say "1,240 MAD across 3 of 5 shops". Presenting a total that silently omits
 * unpriced shops would understate spending, and a figure the user cannot
 * reconcile with their own memory is worse than showing no figure at all.
 */
export async function getSpend(
  pairId: string,
  months: number,
): Promise<{
  currency: string | null;
  months: SpendBucket[];
  by_shopper: Array<{ shopper_id: string; total_minor: number; trips: number }>;
}> {
  const to = new Date();
  const from = new Date(
    Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - (months - 1), 1, 0, 0, 0),
  );
  // Exclusive upper bound one day out, so trips completed today are included
  // regardless of the caller's timezone.
  const toExclusive = new Date(to.getTime() + 24 * 60 * 60 * 1000);

  const [buckets, byShopper, pair] = await Promise.all([
    getMonthlySpend(pairId, from.toISOString(), toExclusive.toISOString()),
    getSpendByShopper(pairId, from.toISOString(), toExclusive.toISOString()),
    findPairById(pairId),
  ]);

  return {
    currency: (pair as { currency?: string | null } | null)?.currency ?? null,
    months: buckets,
    by_shopper: byShopper,
  };
}

/**
 * Attach a price to one item bought on a trip.
 *
 * Writes to two places on purpose. trip_items keeps the price as a fact about
 * that shop, immutable once the trip completes. item_history takes the same
 * figure as an observation, which is what later estimates are built from — so
 * price memory accumulates as a by-product of shopping rather than as something
 * the user maintains.
 *
 * Only allowed while the trip is active: a completed trip is history.
 */
export async function setItemPrice(
  tripId: string,
  itemId: string,
  pairId: string,
  priceMinor: number | null,
): Promise<void> {
  const trip = await findTripById(tripId);
  if (!trip) {
    throw new AppError("NOT_FOUND", 404, "Trip not found.");
  }
  await verifyListAccess(trip.list_id, pairId);
  if (trip.status !== "active") {
    throw new AppError("BAD_REQUEST", 400, "Trip is no longer active.");
  }

  await setPurchasePrice(tripId, itemId, priceMinor);

  // Clearing a price is a correction, not an observation — nothing to learn.
  if (priceMinor !== null) {
    const item = await findItemById(itemId);
    if (item) {
      await recordObservedPrice({
        pairId,
        itemName: item.name,
        category: item.category,
        priceMinor,
      });
    }
  }
}

/**
 * Estimate the cost of what is still unchecked on a list.
 *
 * Reads the live list itself rather than taking names from the client, so the
 * figure always matches what is actually on screen and cannot be influenced by
 * a crafted request.
 */
export async function estimateList(listId: string, pairId: string) {
  await verifyListAccess(listId, pairId);
  const items = await findItemsByListId(listId);
  const pending = items
    .filter((i) => !i.is_checked)
    .map((i) => ({ name: i.name, category: i.category }));
  return estimateListCost(pairId, pending);
}

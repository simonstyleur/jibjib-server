import { AppError } from "../middleware/error.middleware";
import { verifyListAccess } from "../db/queries/list.queries";
import {
  createTrip as dbCreateTrip,
  findActiveTrip as dbFindActiveTrip,
  findTripById,
  endTrip as dbEndTrip,
  findSkippedItems,
} from "../db/queries/trip.queries";
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

  // Count unchecked items as the trip total
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM items
     WHERE list_id = $1
       AND is_checked = false
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
      const shopperName = user?.name ?? "Your partner";
      sendPushNotification(
        partnerId,
        "trip_started",
        "Shopping trip started!",
        `${shopperName} is heading to the store with ${itemsTotal} items`,
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
  const endedTrip = await dbEndTrip(tripId, "completed");

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

  // Send push notification to partner
  const pair = await findPairById(pairId);
  if (pair) {
    const partnerId = pair.user_a_id === _userId ? pair.user_b_id : pair.user_a_id;
    if (partnerId) {
      const user = await findUserById(_userId);
      const shopperName = user?.name ?? "Your partner";
      sendPushNotification(
        partnerId,
        "trip_completed",
        "Shopping trip completed!",
        `${shopperName} finished shopping in ${durationMinutes} min — ${summary.items_done} items bought`,
        { trip_id: summary.id, list_id: trip.list_id },
      );
    }
  }

  return summary;
}

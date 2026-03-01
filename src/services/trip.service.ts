import { AppError } from "../middleware/error.middleware";
import { verifyListAccess } from "../db/queries/list.queries";
import {
  createTrip as dbCreateTrip,
  findActiveTrip as dbFindActiveTrip,
  findTripById,
  endTrip as dbEndTrip,
  findSkippedItems,
} from "../db/queries/trip.queries";
import { query } from "../db/pool";
import { emitToPair } from "../socket/emitter";
import { WS_EVENTS } from "../constants/events";
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

  emitToPair(pairId, WS_EVENTS.TRIP_STARTED, { trip });

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

  // Save checked items as trip snapshot before resetting
  await query(
    `UPDATE trips SET items_done = (
       SELECT COUNT(*)::int FROM items
       WHERE list_id = $2 AND is_checked = true AND deleted_at IS NULL
     ) WHERE id = $1`,
    [tripId, trip.list_id],
  );

  // Reset all checked items for the next trip (uncheck them)
  await query(
    `UPDATE items
     SET is_checked = false, checked_by = NULL, checked_at = NULL
     WHERE list_id = $1
       AND is_checked = true
       AND deleted_at IS NULL`,
    [trip.list_id],
  );

  const summary: TripSummary = {
    ...endedTrip,
    ended_at: endedTrip.ended_at!,
    duration_minutes: durationMinutes,
    skipped_items: skippedItems,
  };

  emitToPair(pairId, WS_EVENTS.TRIP_ENDED, { trip: summary });

  return summary;
}

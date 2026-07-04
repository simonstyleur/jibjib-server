import cron from "node-cron";
import { query } from "../db/pool";
import { logger } from "../utils/logger";
import { endTrip } from "../services/trip.service";
import { TRIP_AUTO_END_HOURS } from "../constants/limits";

interface StaleTripRow {
  id: string;
  pair_id: string;
  shopper_id: string;
}

/**
 * Schedule trip auto-end check every 15 minutes.
 * Finds active trips that have exceeded TRIP_AUTO_END_HOURS and ends each one
 * through the real endTrip service — NOT a raw UPDATE — so auto-ended trips get
 * the same treatment as user-ended ones: items_done snapshot, checked items
 * soft-deleted, and a TRIP_ENDED event whose `{ trip: summary }` payload
 * matches what the mobile handler dereferences (a bare `{ trip_id, ... }`
 * payload crashed both partners' apps).
 */
export function startTripAutoEndJob(): cron.ScheduledTask {
  logger.info(
    { intervalMinutes: 15, autoEndHours: TRIP_AUTO_END_HOURS },
    "Scheduling trip-auto-end job (every 15 minutes)",
  );

  return cron.schedule("*/15 * * * *", async () => {
    try {
      const result = await query<StaleTripRow>(
        `SELECT t.id, l.pair_id, t.shopper_id
         FROM trips t
         JOIN lists l ON l.id = t.list_id
         WHERE t.status = 'active'
           AND t.started_at < NOW() - INTERVAL '${TRIP_AUTO_END_HOURS} hours'`,
      );

      if (result.rows.length === 0) return;

      logger.info({ count: result.rows.length }, "Auto-ending stale trips");

      // Per-trip try/catch: one failing trip (e.g. concurrently ended by its
      // shopper) must not block the rest.
      for (const trip of result.rows) {
        try {
          await endTrip(trip.id, trip.pair_id, trip.shopper_id, "auto_ended");
        } catch (err) {
          logger.error({ err, tripId: trip.id }, "Failed to auto-end trip");
        }
      }
    } catch (err) {
      logger.error({ err }, "Failed to auto-end stale trips");
    }
  });
}

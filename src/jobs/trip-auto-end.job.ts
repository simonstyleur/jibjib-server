import cron from "node-cron";
import { query } from "../db/pool";
import { logger } from "../utils/logger";
import { emitToPair } from "../socket/emitter";
import { WS_EVENTS } from "../constants/events";
import { TRIP_AUTO_END_HOURS } from "../constants/limits";

interface AutoEndedTripRow {
  id: string;
  list_id: string;
  pair_id: string;
  started_at: string;
  ended_at: string;
}

/**
 * Schedule trip auto-end check every 15 minutes.
 * Finds active trips that have exceeded TRIP_AUTO_END_HOURS
 * and automatically ends them with status 'auto_ended'.
 */
export function startTripAutoEndJob(): cron.ScheduledTask {
  logger.info(
    { intervalMinutes: 15, autoEndHours: TRIP_AUTO_END_HOURS },
    "Scheduling trip-auto-end job (every 15 minutes)",
  );

  return cron.schedule("*/15 * * * *", async () => {
    try {
      // Find and auto-end active trips that exceeded the time limit
      const result = await query<AutoEndedTripRow>(
        `UPDATE trips t
         SET status = 'auto_ended', ended_at = NOW()
         FROM lists l
         WHERE t.status = 'active'
           AND l.id = t.list_id
           AND t.started_at < NOW() - INTERVAL '${TRIP_AUTO_END_HOURS} hours'
         RETURNING t.id, t.list_id, l.pair_id, t.started_at, t.ended_at`,
      );

      const autoEndedTrips = result.rows;

      if (autoEndedTrips.length > 0) {
        logger.info(
          { count: autoEndedTrips.length },
          "Auto-ended stale trips",
        );

        // Emit TRIP_ENDED event for each auto-ended trip
        for (const trip of autoEndedTrips) {
          emitToPair(trip.pair_id, WS_EVENTS.TRIP_ENDED, {
            trip_id: trip.id,
            list_id: trip.list_id,
            status: "auto_ended",
            ended_at: trip.ended_at,
          });
        }
      }
    } catch (err) {
      logger.error({ err }, "Failed to auto-end stale trips");
    }
  });
}

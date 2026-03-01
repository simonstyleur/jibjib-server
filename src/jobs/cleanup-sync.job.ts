import cron from "node-cron";
import { query } from "../db/pool";
import { logger } from "../utils/logger";

/**
 * Schedule daily cleanup at 4 AM:
 * Delete processed sync queue entries older than 7 days.
 */
export function startCleanupSyncJob(): cron.ScheduledTask {
  logger.info("Scheduling cleanup-sync job (daily at 4 AM)");

  return cron.schedule("0 4 * * *", async () => {
    try {
      const result = await query(
        `DELETE FROM sync_queue
         WHERE synced_at IS NOT NULL
           AND synced_at < NOW() - INTERVAL '7 days'`,
      );

      const deletedCount = result.rowCount ?? 0;

      if (deletedCount > 0) {
        logger.info(
          { deletedCount },
          "Cleaned up old sync queue entries",
        );
      }
    } catch (err) {
      logger.error({ err }, "Failed to clean up sync queue entries");
    }
  });
}

import cron from "node-cron";
import { query } from "../db/pool";
import { logger } from "../utils/logger";

/**
 * Schedule daily cleanup at 3 AM:
 * 1. Hard-delete soft-deleted items older than 30 days.
 * 2. Delete expired sessions.
 */
export function startCleanupItemsJob(): cron.ScheduledTask {
  logger.info("Scheduling cleanup-items job (daily at 3 AM)");

  return cron.schedule("0 3 * * *", async () => {
    try {
      // Hard-delete soft-deleted items older than 30 days
      const itemsResult = await query(
        `DELETE FROM items
         WHERE deleted_at IS NOT NULL
           AND deleted_at < NOW() - INTERVAL '30 days'`,
      );

      const deletedItems = itemsResult.rowCount ?? 0;

      // Delete expired sessions
      const sessionsResult = await query(
        `DELETE FROM sessions
         WHERE expires_at < NOW()`,
      );

      const deletedSessions = sessionsResult.rowCount ?? 0;

      if (deletedItems > 0 || deletedSessions > 0) {
        logger.info(
          { deletedItems, deletedSessions },
          "Cleaned up old soft-deleted items and expired sessions",
        );
      }
    } catch (err) {
      logger.error({ err }, "Failed to clean up items and sessions");
    }
  });
}

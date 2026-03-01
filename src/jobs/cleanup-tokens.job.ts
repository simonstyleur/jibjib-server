import cron from "node-cron";
import { query } from "../db/pool";
import { logger } from "../utils/logger";

/**
 * Schedule hourly cleanup of expired and unused pairing tokens.
 * Removes tokens that have passed their expiry time and were never used.
 */
export function startCleanupTokensJob(): cron.ScheduledTask {
  logger.info("Scheduling cleanup-tokens job (every hour)");

  return cron.schedule("0 * * * *", async () => {
    try {
      const result = await query(
        `DELETE FROM pairing_tokens
         WHERE expires_at < NOW()
           AND used_at IS NULL`,
      );

      const deletedCount = result.rowCount ?? 0;

      if (deletedCount > 0) {
        logger.info(
          { deletedCount },
          "Cleaned up expired pairing tokens",
        );
      }
    } catch (err) {
      logger.error({ err }, "Failed to clean up expired pairing tokens");
    }
  });
}

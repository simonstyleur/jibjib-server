import { Router, type Request, type Response } from "express";
import { testConnection } from "../db/pool";
import { testRedis } from "../db/redis";
import { logger } from "../utils/logger";

const router = Router();

/**
 * GET /
 * Health check endpoint — no authentication required.
 * Returns server status, version, uptime, and connectivity to DB and Redis.
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const [dbConnected, redisConnected] = await Promise.all([
      testConnection(),
      testRedis(),
    ]);

    const status = dbConnected && redisConnected ? "ok" : "degraded";

    res.json({
      status,
      version: "1.0.0",
      uptime: process.uptime(),
      db: dbConnected ? "connected" : "disconnected",
      redis: redisConnected ? "connected" : "disconnected",
    });
  } catch (err) {
    logger.error({ err }, "Health check failed");
    res.status(503).json({
      status: "error",
      version: "1.0.0",
      uptime: process.uptime(),
      db: "unknown",
      redis: "unknown",
    });
  }
});

export default router;

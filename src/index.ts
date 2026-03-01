import "dotenv/config";
import express from "express";
import { createServer } from "http";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config";
import { logger } from "./utils/logger";
import { redis } from "./db/redis";
import { pool } from "./db/pool";
import { errorHandler } from "./middleware/error.middleware";
import { rateLimit } from "./middleware/rate-limit.middleware";
import { initSocket } from "./socket";

// Route imports
import healthRoutes from "./routes/health.routes";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import pairingRoutes from "./routes/pairing.routes";
import listRoutes from "./routes/list.routes";
import itemRoutes from "./routes/item.routes";
import messageRoutes from "./routes/message.routes";
import mediaRoutes from "./routes/media.routes";
import tripRoutes from "./routes/trip.routes";
import syncRoutes from "./routes/sync.routes";
import notificationRoutes from "./routes/notification.routes";
import commonItemsRoutes from "./routes/common-items.routes";
import deeplinkRoutes from "./routes/deeplink.routes";

// Job imports
import { startCleanupTokensJob } from "./jobs/cleanup-tokens.job";
import { startCleanupItemsJob } from "./jobs/cleanup-items.job";
import { startCleanupSyncJob } from "./jobs/cleanup-sync.job";
import { startTripAutoEndJob } from "./jobs/trip-auto-end.job";

const app = express();
const server = createServer(app);

// Global middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting for auth endpoints (stricter)
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.env === "development" ? 100 : 20,
  keyPrefix: "auth",
});

// Rate limiting for general API (more generous)
const apiRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  keyPrefix: "api",
});

// Public routes (no auth)
app.use("/health", healthRoutes);
app.use("/api/common-items", commonItemsRoutes);
app.use("/", deeplinkRoutes);

// API routes
app.use("/api/auth", authRateLimit, authRoutes);
app.use("/api/user", apiRateLimit, userRoutes);
app.use("/api/pairing", apiRateLimit, pairingRoutes);
app.use("/api/lists", apiRateLimit, listRoutes);
app.use("/api", apiRateLimit, itemRoutes);
app.use("/api", apiRateLimit, messageRoutes);
app.use("/api", apiRateLimit, mediaRoutes);
app.use("/api/trips", apiRateLimit, tripRoutes);
app.use("/api/sync", apiRateLimit, syncRoutes);
app.use("/api/notifications", apiRateLimit, notificationRoutes);

// Error handler (must be last)
app.use(errorHandler);

// Initialize Socket.IO
const io = initSocket(server);

// Connect Redis and start server
async function start() {
  try {
    await redis.connect();
    logger.info("Redis connected");
  } catch (err) {
    logger.warn({ err }, "Redis connection failed — continuing without Redis");
  }

  // Start background jobs
  startCleanupTokensJob();
  startCleanupItemsJob();
  startCleanupSyncJob();
  startTripAutoEndJob();

  server.listen(config.port, () => {
    logger.info(`Server running on port ${config.port} (${config.env})`);
  });
}

// Graceful shutdown
function shutdown(signal: string) {
  logger.info({ signal }, "Received shutdown signal, closing gracefully...");

  server.close(() => {
    logger.info("HTTP server closed");

    io.close(() => {
      logger.info("Socket.IO server closed");
    });

    // Close Redis
    redis.quit().catch(() => {});

    // Close DB pool
    pool.end().then(() => {
      logger.info("Database pool closed");
      process.exit(0);
    }).catch(() => {
      process.exit(1);
    });
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start();

export { app, server };

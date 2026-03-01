import type { Socket } from "socket.io";
import { redis } from "../db/redis";
import { WS_EVENTS } from "../constants/events";
import { OFFLINE_TIMEOUT_SECONDS } from "../constants/limits";
import { logger } from "../utils/logger";

/**
 * Socket data set during authentication middleware.
 */
interface SocketData {
  userId: string;
  pairId: string;
  userName: string;
}

/**
 * Register presence event handlers on the socket.
 */
export function registerPresenceHandlers(socket: Socket & { data: SocketData }): void {
  const { userId } = socket.data;

  /**
   * Handle presence:ping - refresh the online TTL in Redis
   * and update the user's last_active_at timestamp.
   */
  socket.on(WS_EVENTS.PRESENCE_PING, async () => {
    try {
      const onlineKey = `online:${userId}`;

      // Refresh the online TTL
      await redis.set(onlineKey, socket.id, "EX", OFFLINE_TIMEOUT_SECONDS);

      // Store last_active_at for the user (used for display purposes)
      const now = new Date().toISOString();
      await redis.set(`last_active:${userId}`, now);

      logger.debug({ userId }, "Presence ping received");
    } catch (err) {
      logger.error({ err, userId }, "Failed to handle presence:ping");
    }
  });
}

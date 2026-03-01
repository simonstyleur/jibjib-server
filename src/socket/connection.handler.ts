import type { Socket } from "socket.io";
import { redis } from "../db/redis";
import { WS_EVENTS } from "../constants/events";
import { OFFLINE_TIMEOUT_SECONDS } from "../constants/limits";
import { emitToPairExcept } from "./emitter";
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
 * Handle a new socket connection.
 * Sets the user online in Redis and notifies the pair room.
 * Registers the disconnect handler to clean up presence.
 */
export async function handleConnection(socket: Socket & { data: SocketData }): Promise<void> {
  const { userId, pairId, userName } = socket.data;
  const onlineKey = `online:${userId}`;

  try {
    // Mark user as online in Redis with a TTL
    await redis.set(onlineKey, socket.id, "EX", OFFLINE_TIMEOUT_SECONDS);

    // Notify the pair room that this user came online (exclude sender)
    emitToPairExcept(pairId, socket.id, WS_EVENTS.PAIR_USER_ONLINE, {
      user_id: userId,
      user_name: userName,
    });

    logger.info({ userId, pairId, socketId: socket.id }, "User connected via WebSocket");
  } catch (err) {
    logger.error({ err, userId }, "Failed to set user online");
  }

  // Handle disconnection
  socket.on("disconnect", async (reason) => {
    try {
      // Remove the online key
      await redis.del(onlineKey);

      // Notify the pair room that this user went offline
      emitToPairExcept(pairId, socket.id, WS_EVENTS.PAIR_USER_OFFLINE, {
        user_id: userId,
        user_name: userName,
      });

      logger.info({ userId, pairId, socketId: socket.id, reason }, "User disconnected from WebSocket");
    } catch (err) {
      logger.error({ err, userId }, "Failed to handle disconnect cleanup");
    }
  });
}

import type { Socket } from "socket.io";
import { createMessage } from "../db/queries/message.queries";
import { findItemById } from "../db/queries/item.queries";
import { verifyListAccess } from "../db/queries/list.queries";
import { WS_EVENTS } from "../constants/events";
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
 * Payload for the message:send client event.
 */
interface MessageSendPayload {
  item_id: string;
  list_id: string;
  text: string;
  type: "text" | "sticker";
}

/**
 * Register message event handlers on the socket.
 */
export function registerMessageHandlers(socket: Socket & { data: SocketData }): void {
  const { userId, pairId, userName } = socket.data;

  /**
   * Handle message:send - validate, create message in DB, and broadcast to pair.
   */
  socket.on(WS_EVENTS.MESSAGE_SEND, async (payload: MessageSendPayload) => {
    const { item_id, list_id, text, type } = payload;

    // Validate required fields
    if (!item_id || !text || !type) {
      socket.emit("error", { message: "Invalid message:send payload" });
      return;
    }

    try {
      // Verify list belongs to this pair (if list_id provided)
      if (list_id) {
        await verifyListAccess(list_id, pairId);

        // Verify item belongs to this list
        const item = await findItemById(item_id);
        if (!item || item.list_id !== list_id) {
          socket.emit("error", { message: "Item not found in this list" });
          return;
        }
      }

      const message = await createMessage(item_id, userId, text, type);

      // Broadcast the new message to the pair room (excluding sender)
      emitToPairExcept(pairId, socket.id, WS_EVENTS.MESSAGE_NEW, {
        item_id,
        message: {
          ...message,
          sender: { id: userId, name: userName },
        },
      });

      // Acknowledge to the sender with the created message
      socket.emit(WS_EVENTS.MESSAGE_NEW, {
        item_id,
        message: {
          ...message,
          sender: { id: userId, name: userName },
        },
      });

      logger.debug({ userId, pairId, item_id }, "Message sent via WebSocket");
    } catch (err) {
      logger.error({ err, userId, item_id }, "Failed to handle message:send");
      socket.emit("error", { message: "Failed to send message" });
    }
  });

  /**
   * Handle message:typing_start - broadcast typing indicator to pair.
   */
  socket.on(WS_EVENTS.MESSAGE_TYPING_START, (payload: { item_id: string }) => {
    emitToPairExcept(pairId, socket.id, WS_EVENTS.MESSAGE_TYPING, {
      item_id: payload.item_id,
      user_id: userId,
      user_name: userName,
    });
  });

  /**
   * Handle message:typing_stop - broadcast typing stopped to pair.
   */
  socket.on(WS_EVENTS.MESSAGE_TYPING_STOP, (payload: { item_id: string }) => {
    emitToPairExcept(pairId, socket.id, WS_EVENTS.MESSAGE_TYPING_STOPPED, {
      item_id: payload.item_id,
      user_id: userId,
      user_name: userName,
    });
  });

  /**
   * Handle message:read - mark messages as read (stub for v1.1).
   */
  socket.on(WS_EVENTS.MESSAGE_READ, (_payload: { item_id: string }) => {
    // TODO: Implement message read tracking in v1.1
    logger.debug({ userId, pairId }, "message:read received (not yet implemented)");
  });
}

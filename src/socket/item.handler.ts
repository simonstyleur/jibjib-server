import type { Socket } from "socket.io";
import { updateItem } from "../db/queries/item.queries";
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
 * Payload for the item:check client event.
 */
interface ItemCheckPayload {
  list_id: string;
  item_id: string;
  is_checked: boolean;
}

/**
 * Register item event handlers on the socket.
 */
export function registerItemHandlers(socket: Socket & { data: SocketData }): void {
  const { userId, pairId, userName } = socket.data;

  socket.on(WS_EVENTS.ITEM_CHECK, async (payload: ItemCheckPayload) => {
    const { list_id, item_id, is_checked } = payload;

    // Validate required fields
    if (!list_id || !item_id || typeof is_checked !== "boolean") {
      socket.emit("error", { message: "Invalid item:check payload" });
      return;
    }

    try {
      // Verify list belongs to this pair
      await verifyListAccess(list_id, pairId);

      // Verify item belongs to this list
      const item = await findItemById(item_id);
      if (!item || item.list_id !== list_id) {
        socket.emit("error", { message: "Item not found in this list" });
        return;
      }

      // Update the item in the database
      const now = new Date().toISOString();
      await updateItem(item_id, {
        is_checked,
        checked_by: is_checked ? userId : null,
        checked_at: is_checked ? now : null,
      });

      // Emit the checked event to the pair room (excluding sender)
      emitToPairExcept(pairId, socket.id, WS_EVENTS.ITEM_CHECKED, {
        list_id,
        item_id,
        is_checked,
        checked_by: is_checked
          ? { id: userId, name: userName }
          : null,
        checked_at: is_checked ? now : null,
      });

      logger.debug(
        { userId, pairId, item_id, is_checked },
        "Item check toggled via WebSocket",
      );
    } catch (err) {
      logger.error({ err, userId, item_id }, "Failed to handle item:check");
      socket.emit("error", { message: "Failed to update item" });
    }
  });
}

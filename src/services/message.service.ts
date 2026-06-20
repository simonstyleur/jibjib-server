import { AppError } from "../middleware/error.middleware";
import { verifyListAccess } from "../db/queries/list.queries";
import { findItemById } from "../db/queries/item.queries";
import {
  createMessage as dbCreateMessage,
  findMessagesByItemId,
} from "../db/queries/message.queries";
import { findPairById } from "../db/queries/pair.queries";
import { findUserById } from "../db/queries/user.queries";
import { emitToPair } from "../socket/emitter";
import { sendPushNotification } from "./notification.service";
import { WS_EVENTS } from "../constants/events";
import { logger } from "../utils/logger";
import type { Message, MessageType } from "../types";

/**
 * Verify that the item belongs to the given list and the list belongs to the pair.
 * Throws if list or item access is invalid.
 */
async function verifyItemAccess(
  itemId: string,
  listId: string,
  pairId: string,
): Promise<void> {
  // Throws NOT_FOUND / FORBIDDEN if list is invalid
  await verifyListAccess(listId, pairId);

  // Verify the item belongs to this list
  const item = await findItemById(itemId);
  if (!item || item.list_id !== listId) {
    throw new AppError("ITEM_NOT_FOUND", 404, "Item not found in this list.");
  }
}

/**
 * Send a message on an item thread.
 * Verifies access, creates the message, and emits it via WebSocket.
 */
export async function sendMessage(
  itemId: string,
  listId: string,
  pairId: string,
  userId: string,
  text: string,
  type: MessageType,
): Promise<Message> {
  await verifyItemAccess(itemId, listId, pairId);

  const message = await dbCreateMessage(itemId, userId, text, type);

  emitToPair(pairId, WS_EVENTS.MESSAGE_NEW, {
    item_id: itemId,
    list_id: listId,
    message,
  });

  // Push the partner (sendPushNotification filters by item_message preference,
  // so users who muted item messages won't be disturbed). Best-effort —
  // failures must not block the message itself.
  try {
    const pair = await findPairById(pairId);
    if (pair) {
      const partnerId =
        pair.user_a_id === userId ? pair.user_b_id : pair.user_a_id;
      if (partnerId) {
        const [sender, item] = await Promise.all([
          findUserById(userId),
          findItemById(itemId),
        ]);
        const senderName = sender?.name ?? "Your partner";
        const itemName = item?.name ?? "an item";
        const body =
          type === "text"
            ? `${senderName}: ${text}`
            : `${senderName} sent a sticker on ${itemName}`;
        sendPushNotification(
          partnerId,
          "item_message",
          itemName,
          body,
          { item_id: itemId, list_id: listId },
        );
      }
    }
  } catch (err) {
    logger.error({ err, itemId, pairId }, "Failed to send item-message push");
  }

  return message;
}

/**
 * Get paginated messages for an item thread.
 * Returns messages and pagination info.
 */
export async function getMessages(
  itemId: string,
  listId: string,
  pairId: string,
  cursor?: string,
  limit: number = 50,
): Promise<{ messages: Message[]; has_more: boolean; cursor: string | null }> {
  await verifyItemAccess(itemId, listId, pairId);

  // Fetch one extra to determine if there are more
  const messages = await findMessagesByItemId(itemId, cursor, limit + 1);

  const hasMore = messages.length > limit;
  if (hasMore) {
    messages.pop();
  }

  const nextCursor = hasMore && messages.length > 0
    ? messages[messages.length - 1].id
    : null;

  return {
    messages,
    has_more: hasMore,
    cursor: nextCursor,
  };
}

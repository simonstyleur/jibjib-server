import { verifyListAccess } from "../db/queries/list.queries";
import {
  createItems as dbCreateItems,
  findItemById,
  updateItem as dbUpdateItem,
  softDeleteItem,
  restoreItem as dbRestoreItem,
  countItemsByListId,
  findDuplicateNames,
} from "../db/queries/item.queries";
import type { ItemRow } from "../db/queries/item.queries";
import { findPairById } from "../db/queries/pair.queries";
import { findUserById } from "../db/queries/user.queries";
import { incrementItemsAddedDuring } from "../db/queries/trip.queries";
import { AppError } from "../middleware/error.middleware";
import { MAX_ITEMS_PER_LIST, UNDO_WINDOW_SECONDS } from "../constants/limits";
import { emitToPair } from "../socket/emitter";
import { WS_EVENTS } from "../constants/events";
import { sendPushNotification } from "./notification.service";
import type { Item } from "../types";

/**
 * Map a database ItemRow to the API Item type.
 */
function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    name: row.name,
    category: row.category as Item["category"],
    quantity: row.quantity,
    is_checked: row.is_checked,
    checked_by: row.checked_by,
    checked_at: row.checked_at,
    position: row.position,
    photo_urls: row.photo_urls,
    voice_url: row.voice_url,
    has_messages: row.has_messages,
    unread_message_count: row.unread_message_count,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Add items to a list.
 * Verifies list access and enforces MAX_ITEMS_PER_LIST.
 */
export async function addItems(
  listId: string,
  pairId: string,
  userId: string,
  items: Array<{
    name: string;
    category?: string;
    quantity?: string;
    position?: number;
  }>,
): Promise<Item[]> {
  await verifyListAccess(listId, pairId);

  // Filter out items that already exist on the list (case-insensitive)
  const names = items.map((i) => i.name);
  const existingNames = await findDuplicateNames(listId, names);
  const existingSet = new Set(existingNames);
  const uniqueItems = items.filter(
    (i) => !existingSet.has(i.name.trim().toLowerCase()),
  );

  if (uniqueItems.length === 0) {
    throw new AppError(
      "DUPLICATE_ITEM",
      409,
      items.length === 1
        ? `"${items[0].name}" is already on your list.`
        : "All items already exist on your list.",
    );
  }

  // Enforce max items per list
  const currentCount = await countItemsByListId(listId);
  if (currentCount + uniqueItems.length > MAX_ITEMS_PER_LIST) {
    throw new AppError(
      "LIMIT_EXCEEDED",
      400,
      `Cannot add ${uniqueItems.length} items. List has ${currentCount}/${MAX_ITEMS_PER_LIST} items.`,
      { current_count: currentCount, max: MAX_ITEMS_PER_LIST },
    );
  }

  const rows = await dbCreateItems(listId, uniqueItems, userId);
  const created = rows.map(toItem);

  // If a trip is active on this list, count these as added-during-trip so the
  // trip's counters stay consistent (no-op when there's no active trip).
  await incrementItemsAddedDuring(listId, created.length);

  emitToPair(pairId, WS_EVENTS.ITEM_ADDED, {
    list_id: listId,
    items: created,
  });

  // Send push notification to partner
  const pair = await findPairById(pairId);
  if (pair) {
    const partnerId = pair.user_a_id === userId ? pair.user_b_id : pair.user_a_id;
    if (partnerId) {
      const user = await findUserById(userId);
      const adderName = user?.name ?? "Your partner";
      const itemNames = created.map((i) => i.name).join(", ");
      sendPushNotification(
        partnerId,
        "items_added",
        "New items added",
        created.length === 1
          ? `${adderName} added "${created[0].name}" to the list`
          : `${adderName} added ${created.length} items: ${itemNames}`,
        { list_id: listId },
      );
    }
  }

  return created;
}

/**
 * Update a single item.
 * Verifies list access. If is_checked changes, sets/clears checked_by and checked_at.
 */
export async function updateItem(
  itemId: string,
  listId: string,
  pairId: string,
  userId: string,
  updates: {
    name?: string;
    category?: string;
    quantity?: string | null;
    is_checked?: boolean;
    position?: number;
  },
): Promise<Item> {
  await verifyListAccess(listId, pairId);

  // Verify item exists, belongs to this list, and is not soft-deleted
  const existing = await findItemById(itemId);
  if (!existing || existing.list_id !== listId) {
    throw new AppError("NOT_FOUND", 404, "Item not found");
  }

  // Build the update fields
  const fields: Record<string, unknown> = {};

  if (updates.name !== undefined) {
    fields.name = updates.name;
  }
  if (updates.category !== undefined) {
    fields.category = updates.category;
  }
  if (updates.quantity !== undefined) {
    fields.quantity = updates.quantity;
  }
  if (updates.position !== undefined) {
    fields.position = updates.position;
  }

  // Handle check/uncheck logic
  if (updates.is_checked !== undefined) {
    fields.is_checked = updates.is_checked;

    if (updates.is_checked) {
      // Checking the item
      fields.checked_by = userId;
      fields.checked_at = new Date().toISOString();
    } else {
      // Unchecking the item
      fields.checked_by = null;
      fields.checked_at = null;
    }
  }

  const updatedRow = await dbUpdateItem(itemId, fields);
  const item = toItem(updatedRow);

  emitToPair(pairId, WS_EVENTS.ITEM_UPDATED, {
    list_id: listId,
    item,
  });

  return item;
}

/**
 * Soft-delete an item.
 * Returns the deletion timestamp and the undo deadline.
 */
export async function deleteItem(
  itemId: string,
  listId: string,
  pairId: string,
): Promise<{ deleted_at: string; undo_until: string }> {
  await verifyListAccess(listId, pairId);

  // Verify item exists and belongs to this list
  const existing = await findItemById(itemId);
  if (!existing || existing.list_id !== listId) {
    throw new AppError("NOT_FOUND", 404, "Item not found");
  }

  const deletedAt = await softDeleteItem(itemId);
  const undoUntil = new Date(
    new Date(deletedAt).getTime() + UNDO_WINDOW_SECONDS * 1000,
  ).toISOString();

  emitToPair(pairId, WS_EVENTS.ITEM_DELETED, {
    list_id: listId,
    item_id: itemId,
    deleted_at: deletedAt,
  });

  return { deleted_at: deletedAt, undo_until: undoUntil };
}

/**
 * Undo a soft-delete (restore an item).
 * Only works within the UNDO_WINDOW_SECONDS window.
 */
export async function undoDeleteItem(
  itemId: string,
  listId: string,
  pairId: string,
): Promise<Item> {
  await verifyListAccess(listId, pairId);

  // Verify item belongs to this list before restoring
  const existing = await findItemById(itemId);
  if (!existing || existing.list_id !== listId) {
    throw new AppError("NOT_FOUND", 404, "Item not found in this list");
  }

  const restoredRow = await dbRestoreItem(itemId);
  const item = toItem(restoredRow);

  emitToPair(pairId, WS_EVENTS.ITEM_RESTORED, {
    list_id: listId,
    item,
  });

  return item;
}

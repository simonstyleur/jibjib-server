import { verifyListAccess } from "../db/queries/list.queries";
import {
  createItems as dbCreateItems,
  findItemById,
  updateItem as dbUpdateItem,
  softDeleteItem,
  restoreItem as dbRestoreItem,
  countItemsByListId,
} from "../db/queries/item.queries";
import type { ItemRow } from "../db/queries/item.queries";
import { AppError } from "../middleware/error.middleware";
import { MAX_ITEMS_PER_LIST, UNDO_WINDOW_SECONDS } from "../constants/limits";
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

  // Enforce max items per list
  const currentCount = await countItemsByListId(listId);
  if (currentCount + items.length > MAX_ITEMS_PER_LIST) {
    throw new AppError(
      "LIMIT_EXCEEDED",
      400,
      `Cannot add ${items.length} items. List has ${currentCount}/${MAX_ITEMS_PER_LIST} items.`,
      { current_count: currentCount, max: MAX_ITEMS_PER_LIST },
    );
  }

  const rows = await dbCreateItems(listId, items, userId);
  return rows.map(toItem);
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
  return toItem(updatedRow);
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
  return toItem(restoredRow);
}

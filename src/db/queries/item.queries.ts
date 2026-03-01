import { query, getClient } from "../pool";
import { AppError } from "../../middleware/error.middleware";
import { UNDO_WINDOW_SECONDS } from "../../constants/limits";

export interface ItemRow {
  id: string;
  list_id: string;
  name: string;
  category: string;
  quantity: string | null;
  is_checked: boolean;
  checked_by: { id: string; name: string; avatar_url: string | null } | null;
  checked_at: string | null;
  position: number;
  photo_urls: string[];
  voice_url: string | null;
  has_messages: boolean;
  unread_message_count: number;
  created_by: { id: string; name: string; avatar_url: string | null };
  created_at: string;
  updated_at: string;
}

/** SQL fragment that selects an item with joined user info and message counts. */
const ITEM_SELECT = `
  i.id,
  i.list_id,
  i.name,
  i.category,
  i.quantity,
  i.is_checked,
  CASE WHEN i.checked_by IS NOT NULL THEN
    jsonb_build_object('id', cb.id, 'name', cb.name, 'avatar_url', cb.avatar_url)
  ELSE NULL END AS checked_by,
  i.checked_at,
  i.position,
  COALESCE(i.photo_urls, '[]'::jsonb) AS photo_urls,
  i.voice_url,
  EXISTS(SELECT 1 FROM messages m WHERE m.item_id = i.id) AS has_messages,
  0 AS unread_message_count,
  jsonb_build_object('id', cr.id, 'name', cr.name, 'avatar_url', cr.avatar_url) AS created_by,
  i.created_at,
  i.updated_at
`;

const ITEM_JOINS = `
  LEFT JOIN users cb ON cb.id = i.checked_by
  INNER JOIN users cr ON cr.id = i.created_by
`;

/**
 * Batch-insert multiple items into a list.
 * Uses a transaction to ensure atomicity.
 * Returns created items with joined user info.
 */
export async function createItems(
  listId: string,
  items: Array<{
    name: string;
    category?: string;
    quantity?: string;
    position?: number;
  }>,
  createdBy: string,
): Promise<ItemRow[]> {
  const client = await getClient();

  try {
    await client.query("BEGIN");

    // Get the current max position for this list to auto-assign positions
    const posResult = await client.query<{ max_pos: number }>(
      `SELECT COALESCE(MAX(position), -1)::int AS max_pos
       FROM items WHERE list_id = $1 AND deleted_at IS NULL`,
      [listId],
    );
    let nextPosition = posResult.rows[0].max_pos + 1;

    // Build multi-row INSERT
    const values: unknown[] = [];
    const valuePlaceholders: string[] = [];
    let paramIndex = 1;

    for (const item of items) {
      const position = item.position ?? nextPosition++;
      valuePlaceholders.push(
        `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`,
      );
      values.push(
        listId,
        item.name,
        item.category ?? "other",
        item.quantity ?? null,
        position,
      );
    }

    // Add createdBy as the last parameter
    const createdByParam = paramIndex;
    values.push(createdBy);

    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO items (list_id, name, category, quantity, position, created_by)
       VALUES ${valuePlaceholders.map((v) => v.replace(/\)$/, `, $${createdByParam})`)).join(", ")}
       RETURNING id`,
      values,
    );

    const insertedIds = insertResult.rows.map((r) => r.id);

    await client.query("COMMIT");

    // Fetch the full item rows with joins
    const result = await query<ItemRow>(
      `SELECT ${ITEM_SELECT}
       FROM items i
       ${ITEM_JOINS}
       WHERE i.id = ANY($1)
       ORDER BY i.position ASC`,
      [insertedIds],
    );

    return result.rows;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Find all non-deleted items for a list, ordered by position.
 */
export async function findItemsByListId(listId: string): Promise<ItemRow[]> {
  const result = await query<ItemRow>(
    `SELECT ${ITEM_SELECT}
     FROM items i
     ${ITEM_JOINS}
     WHERE i.list_id = $1 AND i.deleted_at IS NULL
     ORDER BY i.position ASC, i.created_at ASC`,
    [listId],
  );
  return result.rows;
}

/**
 * Find a single item by ID (including soft-deleted).
 * Returns null if not found.
 */
export async function findItemById(itemId: string): Promise<ItemRow | null> {
  const result = await query<ItemRow>(
    `SELECT ${ITEM_SELECT}
     FROM items i
     ${ITEM_JOINS}
     WHERE i.id = $1`,
    [itemId],
  );
  return result.rows[0] ?? null;
}

/**
 * Dynamic UPDATE for an item. Only updates provided fields.
 * Returns the updated item with joined user info.
 */
export async function updateItem(
  itemId: string,
  fields: {
    name?: string;
    category?: string;
    quantity?: string | null;
    is_checked?: boolean;
    checked_by?: string | null;
    checked_at?: string | null;
    position?: number;
  },
): Promise<ItemRow> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (fields.name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`);
    values.push(fields.name);
  }
  if (fields.category !== undefined) {
    setClauses.push(`category = $${paramIndex++}`);
    values.push(fields.category);
  }
  if (fields.quantity !== undefined) {
    setClauses.push(`quantity = $${paramIndex++}`);
    values.push(fields.quantity);
  }
  if (fields.is_checked !== undefined) {
    setClauses.push(`is_checked = $${paramIndex++}`);
    values.push(fields.is_checked);
  }
  if (fields.checked_by !== undefined) {
    setClauses.push(`checked_by = $${paramIndex++}`);
    values.push(fields.checked_by);
  }
  if (fields.checked_at !== undefined) {
    setClauses.push(`checked_at = $${paramIndex++}`);
    values.push(fields.checked_at);
  }
  if (fields.position !== undefined) {
    setClauses.push(`position = $${paramIndex++}`);
    values.push(fields.position);
  }

  if (setClauses.length === 0) {
    throw new AppError("BAD_REQUEST", 400, "No fields to update");
  }

  // Add itemId as the last parameter
  values.push(itemId);

  await query(
    `UPDATE items SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`,
    values,
  );

  // Re-fetch the full item with joins
  const updated = await findItemById(itemId);
  if (!updated) {
    throw new AppError("NOT_FOUND", 404, "Item not found after update");
  }

  return updated;
}

/**
 * Soft-delete an item by setting deleted_at = NOW().
 * Returns the deleted_at timestamp.
 */
export async function softDeleteItem(itemId: string): Promise<string> {
  const result = await query<{ deleted_at: string }>(
    `UPDATE items SET deleted_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING deleted_at`,
    [itemId],
  );

  if (result.rows.length === 0) {
    throw new AppError("NOT_FOUND", 404, "Item not found or already deleted");
  }

  return result.rows[0].deleted_at;
}

/**
 * Restore a soft-deleted item (undo delete).
 * Only succeeds if the item was deleted within UNDO_WINDOW_SECONDS.
 */
export async function restoreItem(itemId: string): Promise<ItemRow> {
  const result = await query<{ id: string }>(
    `UPDATE items
     SET deleted_at = NULL
     WHERE id = $1
       AND deleted_at IS NOT NULL
       AND deleted_at > NOW() - INTERVAL '${UNDO_WINDOW_SECONDS} seconds'
     RETURNING id`,
    [itemId],
  );

  if (result.rows.length === 0) {
    throw new AppError(
      "GONE",
      410,
      "Item cannot be restored. The undo window has expired.",
    );
  }

  const restored = await findItemById(itemId);
  if (!restored) {
    throw new AppError("NOT_FOUND", 404, "Item not found after restore");
  }

  return restored;
}

/**
 * Count non-deleted items in a list.
 */
export async function countItemsByListId(listId: string): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::int AS count
     FROM items
     WHERE list_id = $1 AND deleted_at IS NULL`,
    [listId],
  );
  return parseInt(result.rows[0].count, 10);
}

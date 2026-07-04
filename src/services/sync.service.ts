import { getClient } from "../db/pool";
import * as syncQueries from "../db/queries/sync.queries";
import type { SyncChange, SyncResult, SyncConflict } from "../types";
import { logger } from "../utils/logger";

/**
 * Process a batch of sync changes from a client device.
 *
 * For each change:
 * 1. Verify it targets the caller's own active list (never trust client ids)
 * 2. Record it in the sync_queue
 * 3. Apply the change to the relevant entity (item or message)
 * 4. Detect and resolve conflicts using Last-Writer-Wins (LWW) by timestamp
 * 5. Return a SyncResult for each change
 *
 * Each change runs inside its own SAVEPOINT: without one, the first failed
 * statement aborts the whole transaction — every later query throws 25P02 and
 * the final COMMIT silently rolls back, so changes already reported "applied"
 * were never persisted while the client dequeued them.
 */
export async function processSync(
  userId: string,
  pairId: string,
  deviceId: string,
  changes: SyncChange[],
): Promise<SyncResult[]> {
  const client = await getClient();
  const results: SyncResult[] = [];

  try {
    await client.query("BEGIN");

    // The only list this batch may touch. Resolved server-side from the
    // caller's pair — payload.list_id / entity ids are cross-checked against
    // it, otherwise any authenticated user could mutate any list by UUID.
    const listResult = await client.query<{ id: string }>(
      `SELECT id FROM lists
       WHERE pair_id = $1 AND is_active = true AND is_archived = false
       ORDER BY created_at DESC NULLS LAST
       LIMIT 1`,
      [pairId],
    );
    const ownListId = listResult.rows[0]?.id ?? null;

    for (const change of changes) {
      try {
        await client.query("SAVEPOINT sync_change");
        const result = await processSingleChange(
          userId,
          ownListId,
          deviceId,
          change,
          client,
        );
        await client.query("RELEASE SAVEPOINT sync_change");
        results.push(result);
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT sync_change");
        logger.error(
          { err, change, userId },
          "Failed to process sync change",
        );
        results.push({
          client_entity_id: change.entity_id,
          server_entity_id: change.entity_id,
          status: "rejected",
        });
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return results;
}

/**
 * True if the item exists and belongs to the given list.
 * Soft-deleted items still "belong" — deletes/undos need to target them.
 */
async function itemBelongsToList(
  itemId: string,
  listId: string | null,
  client: Awaited<ReturnType<typeof getClient>>,
): Promise<boolean> {
  if (!listId) return false;
  const result = await client.query<{ id: string }>(
    `SELECT id FROM items WHERE id = $1 AND list_id = $2`,
    [itemId, listId],
  );
  return result.rows.length > 0;
}

/**
 * Process a single sync change within an existing transaction.
 * `ownListId` is the caller's active list — the only list a change may touch.
 */
async function processSingleChange(
  userId: string,
  ownListId: string | null,
  deviceId: string,
  change: SyncChange,
  client: Awaited<ReturnType<typeof getClient>>,
): Promise<SyncResult> {
  const { operation, entity_type, entity_id, payload, client_timestamp } = change;

  const rejected: SyncResult = {
    client_entity_id: entity_id,
    server_entity_id: entity_id,
    status: "rejected",
  };

  // Ownership gate. Adds must target the caller's own list; every other item
  // op must reference an item already on it. Messages must target such an
  // item via payload.item_id. Rejected changes are dequeued by the client, so
  // stale post-unpair payloads drain without ever writing.
  if (entity_type === "item") {
    if (operation === "add") {
      if (!ownListId || payload.list_id !== ownListId) return rejected;
    } else if (!(await itemBelongsToList(entity_id, ownListId, client))) {
      return rejected;
    }
  } else if (entity_type === "message") {
    if (
      typeof payload.item_id !== "string" ||
      !(await itemBelongsToList(payload.item_id, ownListId, client))
    ) {
      return rejected;
    }
  } else {
    return rejected;
  }

  // Record the change in the sync queue
  await syncQueries.createSyncEntry(
    userId,
    deviceId,
    operation,
    entity_type,
    entity_id,
    payload,
    client_timestamp,
  );

  // Check for conflicts: find any changes to this entity after the client timestamp
  const conflicts = await syncQueries.findConflicts(entity_id, client_timestamp);
  // Filter out the entry we just created (from this device)
  const otherConflicts = conflicts.filter((c) => c.device_id !== deviceId);

  if (entity_type === "item") {
    return processItemChange(userId, operation, entity_id, payload, client_timestamp, otherConflicts, client);
  }

  return processMessageChange(userId, operation, entity_id, payload, client);
}

/**
 * Process an item-related sync change.
 */
async function processItemChange(
  userId: string,
  operation: string,
  entityId: string,
  payload: Record<string, unknown>,
  clientTimestamp: string,
  otherConflicts: syncQueries.SyncEntryRow[],
  client: Awaited<ReturnType<typeof getClient>>,
): Promise<SyncResult> {
  switch (operation) {
    case "add": {
      // On id conflict with a soft-deleted row, restore it instead of no-op:
      // this is the offline "delete then undo" path — the queued delete
      // flushed first, and this add must bring the item back (with its
      // photos/messages), not silently vanish as already_applied.
      const result = await client.query(
        `INSERT INTO items (id, list_id, name, category, quantity, position, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET deleted_at = NULL
           WHERE items.deleted_at IS NOT NULL
         RETURNING id`,
        [
          entityId,
          payload.list_id,
          payload.name,
          payload.category ?? "other",
          payload.quantity ?? null,
          payload.position ?? 0,
          userId,
        ],
      );

      if (result.rowCount === 0) {
        return {
          client_entity_id: entityId,
          server_entity_id: entityId,
          status: "already_applied",
        };
      }

      return {
        client_entity_id: entityId,
        server_entity_id: entityId,
        status: "applied",
      };
    }

    case "edit": {
      // Detect field-level conflicts using LWW
      if (otherConflicts.length > 0) {
        const latestConflict = otherConflicts[0];
        const conflictingFields = findFieldConflicts(payload, latestConflict.payload);

        if (conflictingFields.length > 0) {
          // Server wins (LWW) — apply the client change only for non-conflicting fields
          const nonConflictingPayload = { ...payload };
          const conflictDetails: SyncConflict = {
            field: conflictingFields[0],
            server_value: latestConflict.payload[conflictingFields[0]],
            server_timestamp: latestConflict.server_timestamp,
            resolution: "server_wins",
          };

          for (const field of conflictingFields) {
            delete nonConflictingPayload[field];
          }

          // Apply non-conflicting fields if any remain
          if (Object.keys(nonConflictingPayload).length > 0) {
            await applyItemUpdate(entityId, nonConflictingPayload, client);
          }

          return {
            client_entity_id: entityId,
            server_entity_id: entityId,
            status: "conflict",
            conflict: conflictDetails,
          };
        }
      }

      await applyItemUpdate(entityId, payload, client);

      return {
        client_entity_id: entityId,
        server_entity_id: entityId,
        status: "applied",
      };
    }

    case "delete": {
      await client.query(
        `UPDATE items SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
        [entityId],
      );

      return {
        client_entity_id: entityId,
        server_entity_id: entityId,
        status: "applied",
      };
    }

    case "check":
    case "uncheck": {
      const isChecked = operation === "check";

      // Detect conflict: if someone else already changed the check state
      if (otherConflicts.length > 0) {
        const latestConflict = otherConflicts[0];
        const serverChecked = latestConflict.operation === "check";

        if (serverChecked !== isChecked) {
          // The server has a different check state — conflict
          return {
            client_entity_id: entityId,
            server_entity_id: entityId,
            status: "conflict",
            conflict: {
              field: "is_checked",
              server_value: serverChecked,
              server_timestamp: latestConflict.server_timestamp,
              resolution: "server_wins",
            },
          };
        }

        // Same state — already applied
        return {
          client_entity_id: entityId,
          server_entity_id: entityId,
          status: "already_applied",
        };
      }

      await client.query(
        `UPDATE items
         SET is_checked = $2,
             checked_by = CASE WHEN $2 THEN $3 ELSE NULL END,
             checked_at = CASE WHEN $2 THEN NOW() ELSE NULL END
         WHERE id = $1 AND deleted_at IS NULL`,
        [entityId, isChecked, userId],
      );

      return {
        client_entity_id: entityId,
        server_entity_id: entityId,
        status: "applied",
      };
    }

    default:
      return {
        client_entity_id: entityId,
        server_entity_id: entityId,
        status: "rejected",
      };
  }
}

/**
 * Process a message-related sync change.
 */
async function processMessageChange(
  userId: string,
  operation: string,
  entityId: string,
  payload: Record<string, unknown>,
  client: Awaited<ReturnType<typeof getClient>>,
): Promise<SyncResult> {
  if (operation !== "add") {
    return {
      client_entity_id: entityId,
      server_entity_id: entityId,
      status: "rejected",
    };
  }

  const result = await client.query(
    `INSERT INTO messages (id, item_id, sender_id, text, type)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      entityId,
      payload.item_id,
      userId,
      payload.text,
      payload.type ?? "text",
    ],
  );

  if (result.rowCount === 0) {
    return {
      client_entity_id: entityId,
      server_entity_id: entityId,
      status: "already_applied",
    };
  }

  return {
    client_entity_id: entityId,
    server_entity_id: entityId,
    status: "applied",
  };
}

/**
 * Apply a partial update to an item. Dynamically builds SET clauses
 * for only the fields present in the payload.
 */
async function applyItemUpdate(
  entityId: string,
  payload: Record<string, unknown>,
  client: Awaited<ReturnType<typeof getClient>>,
): Promise<void> {
  const allowedFields = ["name", "category", "quantity", "position"];
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const field of allowedFields) {
    if (payload[field] !== undefined) {
      setClauses.push(`${field} = $${paramIndex}`);
      values.push(payload[field]);
      paramIndex++;
    }
  }

  if (setClauses.length === 0) return;

  setClauses.push("updated_at = NOW()");
  values.push(entityId);

  await client.query(
    `UPDATE items SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`,
    values,
  );
}

/**
 * Compare two payloads to find fields that were modified in both.
 */
function findFieldConflicts(
  clientPayload: Record<string, unknown>,
  serverPayload: Record<string, unknown>,
): string[] {
  const conflicting: string[] = [];

  for (const key of Object.keys(clientPayload)) {
    if (key in serverPayload && clientPayload[key] !== serverPayload[key]) {
      conflicting.push(key);
    }
  }

  return conflicting;
}

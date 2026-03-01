import { getClient } from "../db/pool";
import * as syncQueries from "../db/queries/sync.queries";
import type { SyncChange, SyncResult, SyncConflict } from "../types";
import { logger } from "../utils/logger";

/**
 * Process a batch of sync changes from a client device.
 *
 * For each change:
 * 1. Record it in the sync_queue
 * 2. Apply the change to the relevant entity (item or message)
 * 3. Detect and resolve conflicts using Last-Writer-Wins (LWW) by timestamp
 * 4. Return a SyncResult for each change
 */
export async function processSync(
  userId: string,
  deviceId: string,
  changes: SyncChange[],
): Promise<SyncResult[]> {
  const client = await getClient();
  const results: SyncResult[] = [];

  try {
    await client.query("BEGIN");

    for (const change of changes) {
      try {
        const result = await processSingleChange(userId, deviceId, change, client);
        results.push(result);
      } catch (err) {
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
 * Process a single sync change within an existing transaction.
 */
async function processSingleChange(
  userId: string,
  deviceId: string,
  change: SyncChange,
  client: Awaited<ReturnType<typeof getClient>>,
): Promise<SyncResult> {
  const { operation, entity_type, entity_id, payload, client_timestamp } = change;

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

  if (entity_type === "message") {
    return processMessageChange(userId, operation, entity_id, payload, client);
  }

  return {
    client_entity_id: entity_id,
    server_entity_id: entity_id,
    status: "rejected",
  };
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
      const result = await client.query(
        `INSERT INTO items (id, list_id, name, category, quantity, position, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING
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
         WHERE id = $1`,
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

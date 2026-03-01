import { query } from "../pool";
import type { SyncOperation } from "../../types";

export interface SyncEntryRow {
  id: string;
  user_id: string;
  device_id: string;
  operation: SyncOperation;
  entity_type: "item" | "message";
  entity_id: string;
  payload: Record<string, unknown>;
  client_timestamp: string;
  server_timestamp: string;
  synced_at: string | null;
  conflict: boolean;
  conflict_data: Record<string, unknown> | null;
}

/**
 * Insert a new sync queue entry.
 */
export async function createSyncEntry(
  userId: string,
  deviceId: string,
  operation: SyncOperation,
  entityType: "item" | "message",
  entityId: string,
  payload: Record<string, unknown>,
  clientTimestamp: string,
): Promise<SyncEntryRow> {
  const result = await query<SyncEntryRow>(
    `INSERT INTO sync_queue (user_id, device_id, operation, entity_type, entity_id, payload, client_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [userId, deviceId, operation, entityType, entityId, payload, clientTimestamp],
  );
  return result.rows[0];
}

/**
 * Find all unsynced entries for a user from other devices.
 * Returns entries that have not yet been synced to the given device.
 */
export async function findUnsyncedByUser(
  userId: string,
  deviceId: string,
): Promise<SyncEntryRow[]> {
  const result = await query<SyncEntryRow>(
    `SELECT * FROM sync_queue
     WHERE user_id = $1
       AND device_id != $2
       AND synced_at IS NULL
     ORDER BY server_timestamp ASC`,
    [userId, deviceId],
  );
  return result.rows;
}

/**
 * Mark sync entries as synced by setting synced_at = NOW().
 */
export async function markSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  await query(
    `UPDATE sync_queue
     SET synced_at = NOW()
     WHERE id = ANY($1::bigint[])`,
    [ids],
  );
}

/**
 * Find sync entries for a specific entity after a given timestamp.
 * Used for conflict detection.
 */
export async function findConflicts(
  entityId: string,
  sinceTimestamp: string,
): Promise<SyncEntryRow[]> {
  const result = await query<SyncEntryRow>(
    `SELECT * FROM sync_queue
     WHERE entity_id = $1
       AND server_timestamp > $2
     ORDER BY server_timestamp DESC`,
    [entityId, sinceTimestamp],
  );
  return result.rows;
}

export type SyncOperation = "add" | "edit" | "delete" | "check" | "uncheck";

export interface SyncChange {
  operation: SyncOperation;
  entity_type: "item" | "message";
  entity_id: string;
  payload: Record<string, unknown>;
  client_timestamp: string;
}

export interface SyncResult {
  client_entity_id: string;
  server_entity_id: string;
  status: "applied" | "conflict" | "rejected" | "already_applied";
  conflict?: SyncConflict;
}

export interface SyncConflict {
  field: string;
  server_value: unknown;
  server_timestamp: string;
  resolution: string;
}

import { z } from "zod";
import { SYNC_BATCH_SIZE } from "../constants/limits";

const syncOperationEnum = z.enum(["add", "edit", "delete", "check", "uncheck"]);
const syncEntityEnum = z.enum(["item", "message"]);

const syncChangeSchema = z.object({
  operation: syncOperationEnum,
  entity_type: syncEntityEnum,
  entity_id: z.string().uuid(),
  payload: z.record(z.unknown()),
  client_timestamp: z.string().datetime(),
});

export const syncSchema = z.object({
  device_id: z.string().min(1),
  changes: z
    .array(syncChangeSchema)
    .min(1)
    .max(SYNC_BATCH_SIZE),
});

export type SyncInput = z.infer<typeof syncSchema>;

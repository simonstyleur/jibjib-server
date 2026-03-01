import { z } from "zod";

export const startTripSchema = z.object({
  list_id: z.string().uuid(),
});

export const activeTripQuerySchema = z.object({
  list_id: z.string().uuid().optional(),
});

export type StartTripInput = z.infer<typeof startTripSchema>;
export type ActiveTripQueryInput = z.infer<typeof activeTripQuerySchema>;

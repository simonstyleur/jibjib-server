import { z } from "zod";

export const startTripSchema = z.object({
  list_id: z.string().uuid(),
});

export const activeTripQuerySchema = z.object({
  list_id: z.string().uuid().optional(),
});

export type StartTripInput = z.infer<typeof startTripSchema>;
export type ActiveTripQueryInput = z.infer<typeof activeTripQuerySchema>;

/**
 * Body for POST /:tripId/end.
 *
 * Every field is optional and the whole body may be absent: 1.0.4 and 1.0.5
 * clients end a trip with no body at all, and must keep working untouched.
 *
 * total_minor is in integer MINOR units (centimes/cents) — money is never a
 * float here, so sums stay exact. The cap is a typo guard, not a real limit:
 * it catches someone entering an amount in minor units twice over rather than
 * constraining a genuine shop.
 */
export const endTripSchema = z
  .object({
    total_minor: z.number().int().min(0).max(100_000_000).nullable().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO code")
      .nullable()
      .optional(),
  })
  .optional()
  .default({});

export type EndTripInput = z.infer<typeof endTripSchema>;

/** Body for setting one item's purchase price. Null clears it. */
export const itemPriceSchema = z.object({
  price_minor: z.number().int().min(0).max(100_000_000).nullable(),
});

export const estimateQuerySchema = z.object({
  list_id: z.string().uuid(),
});

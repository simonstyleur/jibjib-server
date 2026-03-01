import { z } from "zod";

/**
 * Schema for joining an existing pairing.
 * At least one of token (QR UUID), slug (invite link), or code (manual entry) must be provided.
 */
export const joinPairingSchema = z
  .object({
    token: z.string().uuid().optional(),
    slug: z.string().min(1).max(16).optional(),
    code: z.string().min(1).max(7).optional(),
  })
  .refine((data) => data.token || data.slug || data.code, {
    message: "At least one of token, slug, or code must be provided",
  });

export type JoinPairingInput = z.infer<typeof joinPairingSchema>;

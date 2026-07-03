import crypto from "crypto";

// Exclude confusing characters: I, O, 0, 1
const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Generate a pairing code in `JIB-XXXXXX` format.
 * Uses 6 random characters from a charset that excludes visually ambiguous
 * characters (I, O, 0, 1). 32^6 ~ 1.07 billion combinations; combined with
 * the 15-minute code TTL and the strict join rate limit this puts brute
 * force far out of reach (3 characters was only 32,768).
 */
export function generatePairingCode(): string {
  const bytes = crypto.randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CHARSET[bytes[i] % CHARSET.length];
  }
  return `JIB-${code}`;
}

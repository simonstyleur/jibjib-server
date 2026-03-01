import crypto from "crypto";

// Exclude confusing characters: I, O, 0, 1
const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Generate a pairing code in `JIB-XXX` format.
 * Uses 3 random characters from a charset that excludes
 * visually ambiguous characters (I, O, 0, 1).
 */
export function generatePairingCode(): string {
  const bytes = crypto.randomBytes(3);
  let code = "";
  for (let i = 0; i < 3; i++) {
    code += CHARSET[bytes[i] % CHARSET.length];
  }
  return `JIB-${code}`;
}

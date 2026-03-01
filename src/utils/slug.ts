import crypto from "crypto";

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Generate a URL-safe random slug of the given length using crypto.randomBytes.
 */
export function generateSlug(length: number = 8): string {
  const bytes = crypto.randomBytes(length);
  let slug = "";
  for (let i = 0; i < length; i++) {
    slug += CHARSET[bytes[i] % CHARSET.length];
  }
  return slug;
}

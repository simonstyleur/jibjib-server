import { Router, Request, Response, NextFunction } from "express";
import { query } from "../db/pool";
import { AppError } from "../middleware/error.middleware";

const router = Router();

interface PairingTokenRow {
  id: string;
  pair_id: string;
  slug: string;
  created_by: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

interface UserNameRow {
  name: string;
}

const IOS_APP_STORE_URL = "https://apps.apple.com/app/jibjib/id0000000000";
const ANDROID_PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.jibjib.app";

/**
 * GET /pair/:slug
 * Deep link handler for pairing invite links.
 * No authentication required.
 *
 * Behavior:
 * - 404 if slug not found
 * - 410 if pairing token is expired
 * - 409 if pairing token is already used
 * - If Accept: application/json, returns pairing info as JSON
 * - Otherwise, redirects to app store based on User-Agent
 */
router.get(
  "/pair/:slug",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { slug } = req.params;

      // Look up the pairing token by slug (including expired/used for error messages)
      const tokenResult = await query<PairingTokenRow>(
        `SELECT id, pair_id, slug, created_by, expires_at, used_at, revoked_at
         FROM pairing_tokens
         WHERE slug = $1`,
        [slug],
      );

      const token = tokenResult.rows[0];

      if (!token) {
        throw new AppError(
          "PAIRING_NOT_FOUND",
          404,
          "This pairing link was not found.",
        );
      }

      // Check if already used
      if (token.used_at) {
        throw new AppError(
          "PAIRING_USED",
          409,
          "This pairing link has already been used.",
        );
      }

      // Check if revoked
      if (token.revoked_at) {
        throw new AppError(
          "PAIRING_EXPIRED",
          410,
          "This pairing link has been revoked.",
        );
      }

      // Check if expired
      const expiresAt = new Date(token.expires_at);
      if (expiresAt < new Date()) {
        throw new AppError(
          "PAIRING_EXPIRED",
          410,
          "This pairing link has expired.",
        );
      }

      // Token is valid — respond based on Accept header
      const acceptsJson =
        req.headers.accept?.includes("application/json") ?? false;

      if (acceptsJson) {
        // Get the name of the user who created the pairing
        const userResult = await query<UserNameRow>(
          `SELECT name FROM users WHERE id = $1`,
          [token.created_by],
        );

        const creatorName = userResult.rows[0]?.name ?? "Unknown";

        res.json({
          pair_id: token.pair_id,
          created_by: { name: creatorName },
          expires_at: token.expires_at,
          is_valid: true,
        });
        return;
      }

      // Redirect to appropriate app store based on User-Agent
      const userAgent = (req.headers["user-agent"] ?? "").toLowerCase();

      if (userAgent.includes("android")) {
        res.redirect(302, ANDROID_PLAY_STORE_URL);
        return;
      }

      // Default to iOS App Store (covers iOS, iPadOS, Mac, and unknown)
      res.redirect(302, IOS_APP_STORE_URL);
    } catch (err) {
      next(err);
    }
  },
);

export default router;

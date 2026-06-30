import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { uploadAvatar } from "../middleware/upload.middleware";
import { AppError } from "../middleware/error.middleware";
import { updateUser, softDeleteUser } from "../db/queries/user.queries";
import { findActivePairByUserId, findPairedUser, archivePair } from "../db/queries/pair.queries";
import { revokeAllSessionsForUser } from "../services/auth.service";
import { ensureSoloPairAndList } from "../services/pairing.service";
import * as mediaService from "../services/media.service";
import { MAX_USER_NAME_LENGTH } from "../constants/limits";

const router = Router();

/**
 * Schema for updating the user profile.
 */
const updateProfileSchema = z.object({
  name: z.string().min(1).max(MAX_USER_NAME_LENGTH).optional(),
  language: z.enum(["en", "fr", "ar"]).optional(),
  onesignal_player_id: z.string().min(1).optional(),
});

/**
 * GET /user/me
 * Get the authenticated user's profile, including pair/partner info.
 */
router.get(
  "/me",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;

      // Guarantee an active pair + list. Self-heals a user who was unpaired
      // remotely (their partner left) by lazily provisioning a solo pair+list.
      const { pair: activePair } = await ensureSoloPairAndList(user.id);
      const partner = activePair.user_b_id
        ? await findPairedUser(activePair.id, user.id)
        : null;

      const pair = {
        id: activePair.id,
        paired_with: partner
          ? { id: partner.id, name: partner.name, avatar_url: partner.avatar_url }
          : null,
        paired_at: activePair.paired_at,
      };

      res.json({
        data: {
          ...user,
          pair,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PATCH /user/me
 * Update the authenticated user's profile fields (name, language, onesignal_player_id).
 */
router.patch(
  "/me",
  authenticate,
  validate(updateProfileSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await updateUser(req.user!.id, req.body);

      if (!updated) {
        throw new AppError("NOT_FOUND", 404, "User not found.");
      }

      // Re-fetch pair info for the response
      let pair: { id: string; paired_with: { id: string; name: string; avatar_url: string | null } | null; paired_at: string | null } | null = null;

      if (req.pairId) {
        const pairRow = await findActivePairByUserId(updated.id);
        const partner = await findPairedUser(req.pairId, updated.id);

        if (pairRow) {
          pair = {
            id: pairRow.id,
            paired_with: partner
              ? { id: partner.id, name: partner.name, avatar_url: partner.avatar_url }
              : null,
            paired_at: pairRow.paired_at,
          };
        }
      }

      res.json({
        data: {
          ...updated,
          pair,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /user/me/avatar
 * Upload a new avatar image for the authenticated user.
 * Accepts multipart/form-data with a single file under the 'avatar' field.
 * Returns the new avatar_url.
 */
router.post(
  "/me/avatar",
  authenticate,
  (req: Request, res: Response, next: NextFunction) => {
    uploadAvatar(req, res, (err: unknown) => {
      if (err) {
        if (err instanceof AppError) {
          return next(err);
        }
        // Multer size limit error
        if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "LIMIT_FILE_SIZE") {
          return next(
            new AppError("FILE_TOO_LARGE", 400, "Avatar must be 500KB or smaller."),
          );
        }
        return next(err);
      }
      next();
    });
  },
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        throw new AppError("MISSING_FILE", 400, "No avatar file provided.");
      }

      const avatarUrl = await mediaService.uploadAvatar(
        req.user!.id,
        req.file.buffer,
        req.file.mimetype,
      );

      await updateUser(req.user!.id, { avatar_url: avatarUrl });

      res.json({ data: { avatar_url: avatarUrl } });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /user/me
 * Soft-delete the authenticated user's account: archive any active pair (so the
 * partner is unpaired), scrub PII + mark the user deleted, and revoke all
 * sessions. Idempotent-ish; always returns 204.
 */
router.delete(
  "/me",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;

      // Unpair: archive the active pair so the partner is no longer linked.
      const pairRow = await findActivePairByUserId(userId);
      if (pairRow) {
        await archivePair(pairRow.id);
      }

      await softDeleteUser(userId);
      await revokeAllSessionsForUser(userId);

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default router;

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import * as notificationService from "../services/notification.service";

const router = Router();

const updatePreferencesSchema = z.object({
  preferences: z.array(
    z.object({
      type: z.enum([
        "items_added",
        "item_edited",
        "trip_started",
        "item_message",
        "voice_note",
        "trip_completed",
        "last_minute_add",
        "pairing_invite",
      ]),
      enabled: z.boolean(),
    }),
  ).min(1),
});

/**
 * GET /notifications/preferences
 * Returns all notification preferences for the authenticated user.
 */
router.get(
  "/preferences",
  authenticate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const preferences = await notificationService.getPreferences(userId);

      res.json({ preferences });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PATCH /notifications/preferences
 * Update one or more notification preferences for the authenticated user.
 */
router.patch(
  "/preferences",
  authenticate,
  validate(updatePreferencesSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const { preferences } = req.body;

      const updated = await notificationService.updatePreferences(userId, preferences);

      res.json({ preferences: updated });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

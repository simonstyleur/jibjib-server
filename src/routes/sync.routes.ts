import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { requirePair } from "../middleware/pair.middleware";
import { validate } from "../middleware/validate.middleware";
import { syncSchema } from "../validators/sync.schema";
import * as syncService from "../services/sync.service";

const router = Router();

/**
 * POST /sync
 * Process a batch of offline changes from a client device.
 * Requires authentication and an active pair.
 */
router.post(
  "/",
  authenticate,
  requirePair,
  validate(syncSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.id;
      const { device_id, changes } = req.body;

      const results = await syncService.processSync(userId, device_id, changes);

      res.json({
        results,
        server_timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

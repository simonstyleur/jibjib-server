import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { requirePair } from "../middleware/pair.middleware";
import { validate } from "../middleware/validate.middleware";
import { syncSchema } from "../validators/sync.schema";
import * as syncService from "../services/sync.service";
import { emitToPair } from "../socket/emitter";
import { WS_EVENTS } from "../constants/events";

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

      // If anything actually landed, tell the pair to refetch — this is how the
      // partner picks up offline changes that were flushed via the batch endpoint
      // (the individual REST endpoints broadcast, but this one didn't, so the
      // partner previously stayed stale until a manual pull-to-refresh).
      if (results.some((r) => r.status === "applied")) {
        emitToPair(req.pairId!, WS_EVENTS.SYNC_CHANGES_AVAILABLE, {});
      }

      res.json({
        data: {
          results,
          server_timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

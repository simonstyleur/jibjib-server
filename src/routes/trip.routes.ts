import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { requirePair } from "../middleware/pair.middleware";
import { validate, validateQuery } from "../middleware/validate.middleware";
import { startTripSchema, activeTripQuerySchema } from "../validators/trip.schema";
import { startTrip, getActiveTrip, endTrip } from "../services/trip.service";

const router = Router();

/**
 * POST /start
 * Start a new shopping trip for a list.
 */
router.post(
  "/start",
  authenticate,
  requirePair,
  validate(startTripSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { list_id } = req.body;

      const trip = await startTrip(list_id, req.pairId!, req.user!.id);

      res.status(201).json({ trip });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /active
 * Get the currently active trip for a list.
 */
router.get(
  "/active",
  authenticate,
  requirePair,
  validateQuery(activeTripQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const list_id = req.query.list_id as string | undefined;

      if (!list_id) {
        res.json({ trip: null });
        return;
      }

      const trip = await getActiveTrip(list_id, req.pairId!);

      res.json({ trip: trip ?? null });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /:tripId/end
 * End an active trip and get the summary.
 */
router.post(
  "/:tripId/end",
  authenticate,
  requirePair,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tripId = req.params.tripId as string;

      const trip = await endTrip(tripId, req.pairId!, req.user!.id);

      res.json({ trip });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

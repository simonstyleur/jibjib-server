import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { requirePair } from "../middleware/pair.middleware";
import { validate, validateQuery } from "../middleware/validate.middleware";
import {
  startTripSchema,
  activeTripQuerySchema,
  endTripSchema,
  itemPriceSchema,
  estimateQuerySchema,
} from "../validators/trip.schema";
import {
  startTrip,
  getActiveTrip,
  endTrip,
  getSpend,
  setItemPrice,
  estimateList,
} from "../services/trip.service";

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

      res.status(201).json({ data: trip });
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
        res.json({ data: null });
        return;
      }

      const trip = await getActiveTrip(list_id, req.pairId!);

      res.json({ data: trip ?? null });
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
  // Body is optional and every field in it is optional: 1.0.4 and 1.0.5 send
  // no body at all here, and must keep working exactly as before.
  validate(endTripSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tripId = req.params.tripId as string;
      const { total_minor = null, currency = null } = req.body ?? {};

      const trip = await endTrip(
        tripId,
        req.pairId!,
        req.user!.id,
        "completed",
        total_minor ?? null,
        currency ?? null,
      );

      res.json({ data: trip });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /spend?months=6
 * Spend per month for the pair, with how many shops in each actually carry a
 * total so the client can be honest about partial data.
 */
router.get(
  "/spend",
  authenticate,
  requirePair,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = Number(req.query.months);
      const months = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 24) : 6;
      const data = await getSpend(req.pairId!, months);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /estimate?list_id=...
 * Approximate cost of everything still unchecked on the list, from prices this
 * pair has paid before. Returns covered/total so the client can be explicit
 * about how much of the basket the figure actually accounts for.
 */
router.get(
  "/estimate",
  authenticate,
  requirePair,
  validateQuery(estimateQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await estimateList(req.query.list_id as string, req.pairId!);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PUT /:tripId/items/:itemId/price
 * Record what one item cost on this shop. Also feeds the pair's price memory,
 * so future estimates improve without anyone maintaining a price list.
 */
router.put(
  "/:tripId/items/:itemId/price",
  authenticate,
  requirePair,
  validate(itemPriceSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await setItemPrice(
        req.params.tripId as string,
        req.params.itemId as string,
        req.pairId!,
        req.body.price_minor,
      );
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default router;

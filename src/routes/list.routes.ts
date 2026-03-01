import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { requirePair } from "../middleware/pair.middleware";
import { getListsForPair, getListWithItems } from "../services/list.service";

const router = Router();

/**
 * GET /lists
 * Get all lists for the authenticated user's pair.
 */
router.get(
  "/",
  authenticate,
  requirePair,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const lists = await getListsForPair(req.pairId!);
      res.json({ lists });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /lists/:listId
 * Get a single list with all items and active trip info.
 */
router.get(
  "/:listId",
  authenticate,
  requirePair,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const listId = req.params.listId as string;
      const result = await getListWithItems(listId, req.pairId!);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;

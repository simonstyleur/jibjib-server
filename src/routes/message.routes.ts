import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { requirePair } from "../middleware/pair.middleware";
import { validate, validateQuery } from "../middleware/validate.middleware";
import { sendMessageSchema, messagesQuerySchema } from "../validators/message.schema";
import { sendMessage, getMessages } from "../services/message.service";

const router = Router();

/**
 * GET /lists/:listId/items/:itemId/messages
 * Fetch paginated messages for an item thread.
 */
router.get(
  "/lists/:listId/items/:itemId/messages",
  authenticate,
  requirePair,
  validateQuery(messagesQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const listId = req.params.listId as string;
      const itemId = req.params.itemId as string;
      const { cursor, limit } = req.query as { cursor?: string; limit?: number };

      const result = await getMessages(
        itemId,
        listId,
        req.pairId!,
        cursor,
        limit,
      );

      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /lists/:listId/items/:itemId/messages
 * Send a new message on an item thread.
 */
router.post(
  "/lists/:listId/items/:itemId/messages",
  authenticate,
  requirePair,
  validate(sendMessageSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const listId = req.params.listId as string;
      const itemId = req.params.itemId as string;
      const { text, type } = req.body;

      const message = await sendMessage(
        itemId,
        listId,
        req.pairId!,
        req.user!.id,
        text,
        type,
      );

      res.status(201).json({ message });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

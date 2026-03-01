import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { requirePair } from "../middleware/pair.middleware";
import { validate } from "../middleware/validate.middleware";
import { addItemsSchema, updateItemSchema } from "../validators/item.schema";
import {
  addItems,
  updateItem,
  deleteItem,
  undoDeleteItem,
} from "../services/item.service";

const router = Router();

/**
 * POST /lists/:listId/items
 * Add one or more items to a list.
 */
router.post(
  "/lists/:listId/items",
  authenticate,
  requirePair,
  validate(addItemsSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const listId = req.params.listId as string;
      const { items: inputItems } = req.body;
      const items = await addItems(listId, req.pairId!, req.user!.id, inputItems);
      res.status(201).json({ items });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PATCH /lists/:listId/items/:itemId
 * Update a single item.
 */
router.patch(
  "/lists/:listId/items/:itemId",
  authenticate,
  requirePair,
  validate(updateItemSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const listId = req.params.listId as string;
      const itemId = req.params.itemId as string;
      const item = await updateItem(
        itemId,
        listId,
        req.pairId!,
        req.user!.id,
        req.body,
      );
      res.json({ item });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /lists/:listId/items/:itemId
 * Soft-delete an item.
 */
router.delete(
  "/lists/:listId/items/:itemId",
  authenticate,
  requirePair,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const listId = req.params.listId as string;
      const itemId = req.params.itemId as string;
      const result = await deleteItem(itemId, listId, req.pairId!);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /lists/:listId/items/:itemId/undo
 * Undo a soft-delete (restore an item).
 */
router.post(
  "/lists/:listId/items/:itemId/undo",
  authenticate,
  requirePair,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const listId = req.params.listId as string;
      const itemId = req.params.itemId as string;
      const item = await undoDeleteItem(itemId, listId, req.pairId!);
      res.json({ item });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

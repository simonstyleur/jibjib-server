import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { requirePair } from "../middleware/pair.middleware";
import { AppError } from "../middleware/error.middleware";
import { uploadPhoto, uploadVoice } from "../middleware/upload.middleware";
import { verifyListAccess } from "../db/queries/list.queries";
import { findItemById } from "../db/queries/item.queries";
import { query } from "../db/pool";
import {
  uploadItemPhoto,
  uploadItemVoice,
  deleteFile,
} from "../services/media.service";
import { emitToPair } from "../socket/emitter";
import { WS_EVENTS } from "../constants/events";
import { MAX_PHOTOS_PER_ITEM } from "../constants/limits";
import { config } from "../config";

const router = Router();

/**
 * Verify that the item belongs to the given list and the list belongs to the pair.
 * Returns the item row on success.
 */
async function verifyItemAccess(
  itemId: string,
  listId: string,
  pairId: string,
) {
  // Throws NOT_FOUND / FORBIDDEN if list is invalid
  await verifyListAccess(listId, pairId);

  const item = await findItemById(itemId);
  if (!item || item.list_id !== listId) {
    throw new AppError("ITEM_NOT_FOUND", 404, "Item not found in this list.");
  }

  return item;
}

/**
 * Extract the Minio object path from a full public URL.
 * E.g. "http://localhost:9000/jibjib-media/photos/abc/0.jpg" -> "photos/abc/0.jpg"
 */
function urlToObjectPath(url: string): string {
  const bucket = config.minio.bucket;
  const idx = url.indexOf(`/${bucket}/`);
  if (idx === -1) {
    throw new AppError("BAD_REQUEST", 400, "Invalid media URL.");
  }
  return url.substring(idx + `/${bucket}/`.length);
}

/**
 * POST /lists/:listId/items/:itemId/photos
 * Upload a photo for an item. Max 3 photos per item.
 */
router.post(
  "/lists/:listId/items/:itemId/photos",
  authenticate,
  requirePair,
  uploadPhoto,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const listId = req.params.listId as string;
      const itemId = req.params.itemId as string;
      const item = await verifyItemAccess(itemId, listId, req.pairId!);

      if (!req.file) {
        throw new AppError("BAD_REQUEST", 400, "No photo file provided.");
      }

      const currentPhotos: string[] = Array.isArray(item.photo_urls)
        ? item.photo_urls
        : [];

      if (currentPhotos.length >= MAX_PHOTOS_PER_ITEM) {
        throw new AppError(
          "MAX_PHOTOS_REACHED",
          400,
          `Maximum of ${MAX_PHOTOS_PER_ITEM} photos per item.`,
        );
      }

      // Upload to Minio
      const photoUrl = await uploadItemPhoto(
        itemId,
        currentPhotos.length,
        req.file.buffer,
        req.file.mimetype,
      );

      // Update item photo_urls in DB
      const updatedPhotos = [...currentPhotos, photoUrl];
      await query(
        `UPDATE items
         SET photo_urls = $2::jsonb, updated_at = NOW()
         WHERE id = $1`,
        [itemId, JSON.stringify(updatedPhotos)],
      );

      emitToPair(req.pairId!, WS_EVENTS.ITEM_MEDIA_ADDED, {
        item_id: itemId,
        list_id: listId,
        type: "photo",
        photo_url: photoUrl,
        photo_urls: updatedPhotos,
      });

      res.status(201).json({ data: { photo_url: photoUrl, photo_urls: updatedPhotos } });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /lists/:listId/items/:itemId/photos/:index
 * Remove a photo from an item by its index.
 */
router.delete(
  "/lists/:listId/items/:itemId/photos/:index",
  authenticate,
  requirePair,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const listId = req.params.listId as string;
      const itemId = req.params.itemId as string;
      const indexStr = req.params.index as string;
      const item = await verifyItemAccess(itemId, listId, req.pairId!);

      const index = parseInt(indexStr, 10);
      const currentPhotos: string[] = Array.isArray(item.photo_urls)
        ? item.photo_urls
        : [];

      if (isNaN(index) || index < 0 || index >= currentPhotos.length) {
        throw new AppError("BAD_REQUEST", 400, "Invalid photo index.");
      }

      // Delete from Minio
      const photoUrl = currentPhotos[index];
      try {
        const objectPath = urlToObjectPath(photoUrl);
        await deleteFile(config.minio.bucket, objectPath);
      } catch {
        // Ignore Minio deletion errors (file may already be gone)
      }

      // Remove from array
      const updatedPhotos = currentPhotos.filter((_, i) => i !== index);

      // Update item photo_urls in DB
      await query(
        `UPDATE items
         SET photo_urls = $2::jsonb, updated_at = NOW()
         WHERE id = $1`,
        [itemId, JSON.stringify(updatedPhotos)],
      );

      emitToPair(req.pairId!, WS_EVENTS.ITEM_MEDIA_REMOVED, {
        item_id: itemId,
        list_id: listId,
        type: "photo",
        photo_urls: updatedPhotos,
      });

      res.json({ data: { photo_urls: updatedPhotos } });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /lists/:listId/items/:itemId/voice
 * Upload a voice note for an item (replaces any existing voice note).
 */
router.post(
  "/lists/:listId/items/:itemId/voice",
  authenticate,
  requirePair,
  uploadVoice,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const listId = req.params.listId as string;
      const itemId = req.params.itemId as string;
      await verifyItemAccess(itemId, listId, req.pairId!);

      if (!req.file) {
        throw new AppError("BAD_REQUEST", 400, "No voice file provided.");
      }

      // Upload to Minio
      const voiceUrl = await uploadItemVoice(
        itemId,
        req.file.buffer,
        req.file.mimetype,
      );

      // Update item voice_url in DB
      await query(
        `UPDATE items
         SET voice_url = $2, updated_at = NOW()
         WHERE id = $1`,
        [itemId, voiceUrl],
      );

      emitToPair(req.pairId!, WS_EVENTS.ITEM_MEDIA_ADDED, {
        item_id: itemId,
        list_id: listId,
        type: "voice",
        voice_url: voiceUrl,
      });

      res.status(201).json({ data: { voice_url: voiceUrl } });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /lists/:listId/items/:itemId/voice
 * Remove the voice note from an item.
 */
router.delete(
  "/lists/:listId/items/:itemId/voice",
  authenticate,
  requirePair,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const listId = req.params.listId as string;
      const itemId = req.params.itemId as string;
      const item = await verifyItemAccess(itemId, listId, req.pairId!);

      if (!item.voice_url) {
        throw new AppError("NOT_FOUND", 404, "No voice note to delete.");
      }

      // Delete from Minio
      try {
        const objectPath = urlToObjectPath(item.voice_url);
        await deleteFile(config.minio.bucket, objectPath);
      } catch {
        // Ignore Minio deletion errors (file may already be gone)
      }

      // Null out voice_url in DB
      await query(
        `UPDATE items
         SET voice_url = NULL, updated_at = NOW()
         WHERE id = $1`,
        [itemId],
      );

      emitToPair(req.pairId!, WS_EVENTS.ITEM_MEDIA_REMOVED, {
        item_id: itemId,
        list_id: listId,
        type: "voice",
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default router;

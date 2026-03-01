import { Router, Request, Response, NextFunction } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { joinPairingSchema } from "../validators/pairing.schema";
import * as pairingService from "../services/pairing.service";

const router = Router();

/**
 * POST /pairing/create
 * Create a new pairing for the authenticated user.
 * Returns QR token, invite link slug, and manual code.
 */
router.post(
  "/create",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pairing = await pairingService.createPairing(req.user!.id);
      res.status(201).json({ data: pairing });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /pairing/join
 * Join an existing pairing via QR token, slug, or code.
 */
router.post(
  "/join",
  authenticate,
  validate(joinPairingSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await pairingService.joinPairing(req.user!.id, req.body);
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /pairing/refresh-qr
 * Refresh the QR code / invite link / manual code for a pending pairing.
 */
router.post(
  "/refresh-qr",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pairing = await pairingService.refreshQr(req.user!.id);
      res.status(200).json({ data: pairing });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /pairing
 * Unpair (archive) the authenticated user's current pair.
 */
router.delete(
  "/",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await pairingService.unpair(req.user!.id);
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

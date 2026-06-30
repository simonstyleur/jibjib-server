import { Router, Request, Response, NextFunction } from "express";
import { validate } from "../middleware/validate.middleware";
import { authenticate } from "../middleware/auth.middleware";
import {
  anonymousSchema,
  socialSchema,
  linkSchema,
  refreshSchema,
  logoutSchema,
} from "../validators/auth.schema";
import type { AnonymousInput, SocialInput, LinkInput, RefreshInput, LogoutInput } from "../validators/auth.schema";
import {
  createAnonymousUser,
  loginWithSocial,
  linkSocialAccount,
  refreshTokens,
  logout,
} from "../services/auth.service";

const router = Router();

/**
 * POST /anonymous
 * Register a new anonymous user. Returns the user profile and token pair.
 */
router.post(
  "/anonymous",
  validate(anonymousSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = req.body as AnonymousInput;
      const result = await createAnonymousUser(data);

      res.status(201).json({
        data: {
          user: result.user,
          tokens: result.tokens,
          pair_id: result.pair.id,
          list: {
            id: result.list.id,
            name: result.list.name,
            is_active: result.list.is_active,
          },
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /social
 * Social login. Verifies the provider identity token and returns the user +
 * token pair (same shape as /anonymous). Apple is live; other providers 501.
 */
router.post(
  "/social",
  validate(socialSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = req.body as SocialInput;
      const result = await loginWithSocial(data);

      res.status(200).json({
        data: {
          user: result.user,
          tokens: result.tokens,
          pair_id: result.pair.id,
          list: {
            id: result.list.id,
            name: result.list.name,
            is_active: result.list.is_active,
          },
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /link
 * Attach a social provider to the authenticated user (anonymous → recoverable).
 */
router.post(
  "/link",
  authenticate,
  validate(linkSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = req.body as LinkInput;
      const user = await linkSocialAccount(req.user!.id, data);
      res.status(200).json({ data: { user } });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /refresh
 * Exchange a valid refresh token for a new token pair (token rotation).
 */
router.post(
  "/refresh",
  validate(refreshSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refresh_token } = req.body as RefreshInput;
      const result = await refreshTokens(refresh_token);

      res.status(200).json({
        data: result.tokens,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /logout
 * Revoke the session associated with the given refresh token.
 * Requires authentication.
 */
router.post(
  "/logout",
  authenticate,
  validate(logoutSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refresh_token, device_id } = req.body as LogoutInput;
      await logout(refresh_token, device_id);

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default router;

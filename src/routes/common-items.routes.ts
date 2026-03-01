import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { validateQuery } from "../middleware/validate.middleware";
import { query } from "../db/pool";

const router = Router();

const VALID_LANGS = ["en", "fr", "ar"] as const;
type Lang = (typeof VALID_LANGS)[number];

const commonItemsQuerySchema = z.object({
  q: z.string().min(1).optional(),
  lang: z.enum(VALID_LANGS).default("en"),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/** Map validated lang to its SQL column name. */
const LANG_COLUMN: Record<Lang, string> = {
  en: "name_en",
  fr: "name_fr",
  ar: "name_ar",
};

interface CommonItemResultRow {
  name: string;
  category: string;
  popularity: number;
}

/**
 * GET /common-items
 * Search common grocery items by name. No authentication required.
 *
 * Query params:
 *   q     - search term (optional; if omitted, returns top items by popularity)
 *   lang  - language to search in: en, fr, ar (default: en)
 *   limit - max results 1-50 (default: 10)
 */
router.get(
  "/",
  validateQuery(commonItemsQuerySchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { q, lang, limit } = req.query as unknown as {
        q?: string;
        lang: Lang;
        limit: number;
      };

      // lang is validated by Zod to be one of en/fr/ar, so LANG_COLUMN[lang] is safe
      const col = LANG_COLUMN[lang];

      let result;
      if (q) {
        result = await query<CommonItemResultRow>(
          `SELECT ${col} AS name, category, popularity
           FROM common_items
           WHERE ${col} ILIKE $1
           ORDER BY popularity DESC
           LIMIT $2`,
          [`%${q}%`, limit],
        );
      } else {
        result = await query<CommonItemResultRow>(
          `SELECT ${col} AS name, category, popularity
           FROM common_items
           ORDER BY popularity DESC
           LIMIT $1`,
          [limit],
        );
      }

      const items = result.rows.map((row) => ({
        name: row.name,
        category: row.category,
        popularity: row.popularity,
      }));

      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

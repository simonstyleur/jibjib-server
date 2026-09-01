-- Price memory per pair, and the basket estimate it feeds.
--
-- Additive only: four nullable/defaulted columns on a table that no shipped
-- client reads. 1.0.4 and 1.0.5 are unaffected.
--
-- item_history has existed since the baseline schema with read queries and a
-- service wrapping them, and nothing has ever inserted into it. Price memory
-- is what finally gives it a writer, and the same rows then serve three
-- purposes: recurring-item suggestions, remembered prices, and the estimate
-- shown when a shop starts.
--
-- Scoped by pair_id, like everything else here: a price this couple paid is
-- theirs. It never pools across accounts, so two pairs shopping the same shop
-- each build their own independent memory.

-- What they paid most recently. Preferred over the average when estimating,
-- because grocery prices drift and last week beats a two-year mean.
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS last_price_minor INTEGER;

-- Rolling mean over observed purchases, kept for stability when the last
-- price was an outlier (a promotion, a different size).
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS avg_price_minor INTEGER;

-- How many prices the average is built from. Exposed so the client can say how
-- confident an estimate is instead of implying precision it does not have.
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS price_samples INTEGER NOT NULL DEFAULT 0;

-- A price the user set by hand. Kept SEPARATE from the observed values rather
-- than overwriting them: a manual figure wins while it is set, but removing it
-- must fall back to what was actually paid, and one correction should never
-- destroy real history.
ALTER TABLE item_history ADD COLUMN IF NOT EXISTS manual_price_minor INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_history_prices_nonneg') THEN
    ALTER TABLE item_history ADD CONSTRAINT chk_history_prices_nonneg CHECK (
      (last_price_minor   IS NULL OR last_price_minor   >= 0) AND
      (avg_price_minor    IS NULL OR avg_price_minor    >= 0) AND
      (manual_price_minor IS NULL OR manual_price_minor >= 0) AND
      price_samples >= 0
    );
  END IF;
END $$;

-- Lookup path for the estimate: given a pair and the names on the list, fetch
-- the known prices in one query.
CREATE INDEX IF NOT EXISTS idx_history_pair_name ON item_history (pair_id, item_name);

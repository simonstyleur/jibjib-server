-- Record what a shop SKIPPED, not only what it bought.
--
-- Additive: one defaulted column on a table introduced yesterday that no
-- shipped client reads.
--
-- Why: skipped items were only ever derived from the live list — everything
-- still unchecked at the moment a trip ended. That answers "what is left now",
-- not "what did we skip on that shop three weeks ago", and the two diverge the
-- instant anyone edits the list. With trip history moving server-side, the
-- record has to hold both halves of a trip's outcome or the past cannot be
-- shown accurately.
--
-- Existing rows are all purchases, so the default is correct for them.

ALTER TABLE trip_items
  ADD COLUMN IF NOT EXISTS was_bought BOOLEAN NOT NULL DEFAULT TRUE;

-- History reads a trip's rows split by outcome, so the index carries it.
CREATE INDEX IF NOT EXISTS idx_trip_items_trip_outcome
  ON trip_items (trip_id, was_bought);

-- A skipped item has no price by definition. Cheap guard against a future bug
-- writing one.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_trip_item_skipped_unpriced') THEN
    ALTER TABLE trip_items ADD CONSTRAINT chk_trip_item_skipped_unpriced
      CHECK (was_bought OR price_minor IS NULL);
  END IF;
END $$;

-- The unique key was (trip_id, item_id) and stays correct: an item is either
-- bought or skipped on a given trip, never both.

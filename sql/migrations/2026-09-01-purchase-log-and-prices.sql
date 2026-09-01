-- Purchase log + money, for spend tracking.
--
-- Strictly additive: one new table and four nullable columns. No existing
-- column changes type, gains NOT NULL, or is dropped, so 1.0.4 and 1.0.5
-- clients keep working against this schema unchanged — they simply never read
-- or write the new fields.
--
-- Why a new table rather than items.price: price belongs to a PURCHASE, not to
-- an item. `items` is the live list and unchecked rows carry over between
-- trips, so a price column there would be overwritten on every shop and no
-- history could exist. trip_items records what was actually bought, when, by
-- whom, and for how much.

CREATE TABLE IF NOT EXISTS trip_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id       UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,

  -- Nullable and ON DELETE SET NULL: the live item may be deleted or the list
  -- cleared long after the shop. The purchase still happened.
  item_id       UUID REFERENCES items(id) ON DELETE SET NULL,

  -- Denormalised on purpose, for the same reason. A purchase log that loses
  -- its contents when the item row goes away is not a log.
  item_name     VARCHAR(255) NOT NULL,
  category      item_category NOT NULL DEFAULT 'other',
  quantity      VARCHAR(50),

  -- Integer MINOR units (centimes, cents). Never float or numeric: minor units
  -- sum exactly, and money that drifts by rounding is money nobody trusts.
  -- Nullable because pricing an individual item is always optional.
  price_minor   INTEGER,

  checked_by    UUID REFERENCES users(id),
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_trip_item_price_nonneg CHECK (price_minor IS NULL OR price_minor >= 0),
  -- One row per item per trip. Re-checking an item must update, not duplicate.
  CONSTRAINT uq_trip_item UNIQUE (trip_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_items_trip ON trip_items (trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_items_name ON trip_items (item_name);

-- Currency is a property of the pair: it is shared money, not a personal
-- preference. Nullable rather than defaulted so "never set" stays
-- distinguishable from "deliberately chose USD" — the client resolves it from
-- the device locale on first use.
ALTER TABLE pairs ADD COLUMN IF NOT EXISTS currency CHAR(3);

-- The trip total is stored, NOT derived from SUM(trip_items.price_minor).
-- A receipt includes bags, deposits and discounts, and items bought that were
-- never on the list. A total that disagrees with the user's own receipt is
-- worse than no total, so the number they typed is authoritative.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS total_minor INTEGER;

-- Stamped per trip so a pair that changes currency does not silently
-- reinterpret its own history.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS currency CHAR(3);

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, and the runner is forward-only
-- but a partially-failed apply must still be re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_trip_total_nonneg'
  ) THEN
    ALTER TABLE trips ADD CONSTRAINT chk_trip_total_nonneg
      CHECK (total_minor IS NULL OR total_minor >= 0);
  END IF;
END $$;

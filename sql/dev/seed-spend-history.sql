-- Seed three months of shopping history for ONE pair, to exercise the
-- spending chart and the basket estimate.
--
-- ─────────────────────────────────────────────────────────────────────────
-- THIS WRITES TO WHATEVER DATABASE YOU POINT IT AT, INCLUDING PRODUCTION.
-- It touches only the pair named below, and every trip it creates carries a
-- '5eed0000' id prefix so the teardown at the bottom removes exactly what it
-- added and nothing else.
-- ─────────────────────────────────────────────────────────────────────────
--
-- It aborts if the pair cannot be resolved, rather than silently seeding the
-- wrong couple.

BEGIN;

DO $$
DECLARE
  v_pair  UUID;
  v_list  UUID;
  v_tom   UUID;
  v_emma  UUID;
  -- Shops: days back from today, who shopped, total in MINOR units, item count.
  -- A NULL total is a real shop nobody priced — that is what makes the chart's
  -- partial-coverage hatching appear, so some are left deliberately unpriced.
  v_trips CONSTANT JSONB := '[
    {"d":  2, "who":"emma", "total":  31200, "n": 9},
    {"d":  6, "who":"tom",  "total":  18750, "n": 5},
    {"d": 11, "who":"emma", "total":   null, "n": 7},
    {"d": 16, "who":"tom",  "total":  42300, "n":12},
    {"d": 23, "who":"emma", "total":  27600, "n": 8},
    {"d": 31, "who":"tom",  "total":  35400, "n":10},
    {"d": 38, "who":"emma", "total":  22100, "n": 6},
    {"d": 45, "who":"tom",  "total":   null, "n": 4},
    {"d": 52, "who":"emma", "total":  39800, "n":11},
    {"d": 59, "who":"tom",  "total":  28900, "n": 8},
    {"d": 67, "who":"emma", "total":  33500, "n": 9},
    {"d": 74, "who":"tom",  "total":  19400, "n": 5},
    {"d": 81, "who":"emma", "total":  45200, "n":13},
    {"d": 88, "who":"tom",  "total":  26700, "n": 7}
  ]';
  v_t     JSONB;
  v_i     INT := 0;
  v_who   UUID;
  v_end   TIMESTAMPTZ;
  v_name  TEXT;
BEGIN
  -- Resolve the pair from the two names. Abort loudly on anything ambiguous.
  SELECT p.id, p.user_a_id, p.user_b_id
    INTO v_pair, v_tom, v_emma
    FROM pairs p
    JOIN users ua ON ua.id = p.user_a_id
    JOIN users ub ON ub.id = p.user_b_id
   WHERE (lower(ua.name) = 'tom'  AND lower(ub.name) = 'emma')
      OR (lower(ua.name) = 'emma' AND lower(ub.name) = 'tom')
   LIMIT 1;

  IF v_pair IS NULL THEN
    RAISE EXCEPTION 'No pair found for Tom + Emma. Nothing seeded.';
  END IF;

  -- Make sure v_tom really is Tom, whichever slot he occupies on the pair.
  SELECT lower(name) INTO v_name FROM users WHERE id = v_tom;
  IF v_name <> 'tom' THEN
    SELECT v_emma, v_tom INTO v_tom, v_emma;
  END IF;

  SELECT id INTO v_list FROM lists WHERE pair_id = v_pair ORDER BY created_at LIMIT 1;
  IF v_list IS NULL THEN
    RAISE EXCEPTION 'Pair % has no list. Nothing seeded.', v_pair;
  END IF;

  FOR v_t IN SELECT * FROM jsonb_array_elements(v_trips) LOOP
    v_i   := v_i + 1;
    v_who := CASE WHEN v_t->>'who' = 'tom' THEN v_tom ELSE v_emma END;
    v_end := NOW() - ((v_t->>'d')::int * INTERVAL '1 day');

    INSERT INTO trips (
      id, list_id, shopper_id, status,
      items_total, items_done, items_added_during,
      started_at, ended_at, total_minor, currency
    ) VALUES (
      ('5eed0000-0000-0000-0000-' || lpad(v_i::text, 12, '0'))::uuid,
      v_list, v_who, 'completed',
      (v_t->>'n')::int, (v_t->>'n')::int, 0,
      v_end - INTERVAL '35 minutes', v_end,
      (v_t->>'total')::int,
      CASE WHEN v_t->>'total' IS NULL THEN NULL ELSE 'MAD' END
    );
  END LOOP;

  -- Currency on the pair, so the client formats these as MAD rather than
  -- falling back to the device region.
  UPDATE pairs SET currency = 'MAD' WHERE id = v_pair AND currency IS NULL;

  -- Price memory, so the basket estimate has something to work from. Written
  -- the way the app writes it: a last price plus a running mean and a sample
  -- count. Names are lower-cased, matching normalizeName on the client.
  INSERT INTO item_history (pair_id, item_name, category, last_added_at, add_count,
                            last_price_minor, avg_price_minor, price_samples)
  VALUES
    (v_pair, 'milk',      'dairy',     NOW(),  9, 1250, 1210, 6),
    (v_pair, 'bread',     'bakery',    NOW(), 12,  800,  780, 8),
    (v_pair, 'eggs',      'dairy',     NOW(),  7, 2200, 2150, 5),
    (v_pair, 'tomato',    'produce',   NOW(),  8, 1400, 1330, 6),
    (v_pair, 'potato',    'produce',   NOW(),  6,  900,  880, 4),
    (v_pair, 'carrot',    'produce',   NOW(),  5,  700,  690, 4),
    (v_pair, 'chicken',   'meat',      NOW(),  6, 6500, 6300, 5),
    (v_pair, 'rice',      'other',     NOW(),  4, 1800, 1750, 3),
    (v_pair, 'oil',       'other',     NOW(),  3, 3200, 3100, 3),
    (v_pair, 'coffee',    'beverages', NOW(),  4, 4500, 4400, 3),
    (v_pair, 'cake',      'bakery',    NOW(),  2, 1600, 1600, 1),
    (v_pair, 'pear',      'produce',   NOW(),  3, 1100, 1080, 2)
  ON CONFLICT (pair_id, item_name) DO UPDATE
    SET last_price_minor = EXCLUDED.last_price_minor,
        avg_price_minor  = EXCLUDED.avg_price_minor,
        price_samples    = EXCLUDED.price_samples,
        updated_at       = NOW();

  RAISE NOTICE 'Seeded % trips for pair % (list %)', v_i, v_pair, v_list;
END $$;

COMMIT;

-- ── Verify: this is what the spending chart will show ─────────────────────
SELECT to_char(date_trunc('month', ended_at), 'YYYY-MM') AS month,
       count(*)                                          AS shops,
       count(total_minor)                                AS priced,
       COALESCE(sum(total_minor), 0) / 100.0             AS total_mad
  FROM trips
 WHERE id::text LIKE '5eed0000%'
 GROUP BY 1
 ORDER BY 1 DESC;

-- ── Teardown — removes exactly what this script added ─────────────────────
--
--   DELETE FROM trips WHERE id::text LIKE '5eed0000%';
--
-- The item_history rows are indistinguishable from real price memory once
-- written, so they are left alone by the line above. Remove them only if you
-- want the pair's learned prices reset:
--
--   DELETE FROM item_history
--    WHERE pair_id = (
--      SELECT p.id FROM pairs p
--        JOIN users ua ON ua.id = p.user_a_id
--        JOIN users ub ON ub.id = p.user_b_id
--       WHERE lower(ua.name) IN ('tom','emma')
--         AND lower(ub.name) IN ('tom','emma')
--       LIMIT 1);

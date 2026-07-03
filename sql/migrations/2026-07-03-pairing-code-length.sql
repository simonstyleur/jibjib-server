-- Pairing codes grew from JIB-XXX (7 chars) to JIB-XXXXXX (10 chars) for
-- brute-force resistance; widen the column to fit (12 leaves headroom).
ALTER TABLE pairing_tokens ALTER COLUMN code TYPE VARCHAR(12);

-- Migration: backfill_api_key_hashes
-- Purpose : Null-out legacy plaintext `key` values on rows that have
--           already been hashed by the TypeScript backfill script
--           (scripts/api-key-backfill.ts).
--
-- Run order:
--   1. Run `ts-node scripts/api-key-backfill.ts` first — it computes
--      SHA-256 hashes in application code and writes `keyHash` /
--      `keyPreview` for every row where `key IS NOT NULL`.
--   2. Then run `prisma migrate deploy` (or `prisma migrate dev`) —
--      this migration will clear `key` for every row whose hash was
--      successfully backfilled.
--
-- Idempotency:
--   The predicate `key IS NOT NULL AND keyHash IS NOT NULL` means:
--     • If the TS script has not run yet — zero rows matched → no-op.
--     • If this migration has already run — zero rows matched → no-op.
--     • A double-run is therefore always safe.
--
-- Concurrency:
--   SQLite serialises writes at the connection level. The transaction
--   below is still included for atomicity on engines that support it
--   (e.g. PostgreSQL, if the DB is ever migrated).
--   On PostgreSQL, replace the comment with:
--     SELECT pg_advisory_xact_lock(hashtext('backfill_api_key_hashes'));

BEGIN;

-- Step 1: Acquire advisory lock to prevent concurrent backfill runs.
-- hashtext() is a built-in PostgreSQL function that converts a text value
-- to a stable 32-bit integer, suitable for use as an advisory lock key.
SELECT pg_advisory_xact_lock(hashtext('backfill_api_key_hashes'));

-- Step 2: Clear the plaintext key for every row that the TS script
-- has already hashed.  Rows where keyHash IS NULL are left untouched
-- so a partial backfill can be resumed safely.
UPDATE "ApiKey"
SET    "key" = NULL
WHERE  "key" IS NOT NULL
  AND  "keyHash" IS NOT NULL;

COMMIT;

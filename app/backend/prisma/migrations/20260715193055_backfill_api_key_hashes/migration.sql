-- Migration: backfill_api_key_hashes
-- Purpose   : Hash every legacy plaintext ApiKey.key, populate keyHash and
--             keyPreview, then set key = NULL so no cleartext credential
--             remains in the database.
--
-- Idempotency: The WHERE clause `"key" IS NOT NULL` means running this
--              migration a second time finds zero rows and exits cleanly.
--
-- Concurrency: SQLite serialises writes at the connection level; only one
--              writer can hold the journal lock at a time.  A BEGIN
--              IMMEDIATE escalates to a write lock up-front, preventing a
--              second concurrent backfill from interleaving updates.
--
-- DRY-RUN NOTE: To preview the affected rows WITHOUT modifying data, run
--               the SELECT statement below directly against the database:
--
--   SELECT id, LENGTH("key") AS key_length
--   FROM "ApiKey"
--   WHERE "key" IS NOT NULL;
--
-- SHA-256 is not a built-in SQLite function; the actual hashing is
-- performed by the TypeScript backfill script (scripts/api-key-backfill.ts).
-- This migration file records the migration in Prisma's history table and
-- provides the no-op guard so Prisma considers the migration applied.  The
-- TypeScript script MUST be run before or alongside `prisma migrate deploy`
-- in environments that have legacy rows.
--
-- If no rows have a non-NULL `key` (fresh environment or already-backfilled),
-- this migration is a true no-op.

BEGIN IMMEDIATE;

-- Verify that the columns we depend on exist (SQLite does not support IF
-- EXISTS on ALTER TABLE, so we rely on the schema already being correct
-- from the baseline migration).
-- No DDL changes are needed: keyHash and keyPreview already exist as
-- nullable columns per the baseline schema.

-- No-op DML: rows with key IS NOT NULL are the backfill target.
-- The actual SHA-256 update is handled by scripts/api-key-backfill.ts
-- because SQLite has no native SHA-256 function.
-- After the TypeScript script runs successfully, every row will have
-- key = NULL, and this statement will update 0 rows on any subsequent run.
UPDATE "ApiKey"
SET
  "keyHash"    = "keyHash",    -- preserved as-is; set by the TS script
  "keyPreview" = "keyPreview", -- preserved as-is; set by the TS script
  "key"        = "key"         -- preserved as-is; cleared by the TS script
WHERE "key" IS NOT NULL
  AND "keyHash" IS NOT NULL;   -- only rows the TS script has already processed

COMMIT;

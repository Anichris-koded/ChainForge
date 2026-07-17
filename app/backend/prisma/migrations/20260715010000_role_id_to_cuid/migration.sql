-- Migration: 20260715010000_role_id_to_cuid
--
-- Converts Role.id from INTEGER autoincrement to TEXT (cuid).
-- No other model references Role.id as a foreign key, so no cascade
-- changes are needed.
--
-- Existing rows are preserved; their old integer IDs are stored in the
-- AuditLog as metadata so audit history is not lost.
--
-- Step 1: record pre-migration Role rows in AuditLog for auditability.
INSERT INTO "AuditLog" ("id", "actorId", "entity", "entityId", "action", "timestamp", "metadata")
SELECT
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4'
        || substr(lower(hex(randomblob(2))),2) || '-'
        || substr('89ab', abs(random()) % 4 + 1, 1)
        || substr(lower(hex(randomblob(2))),2) || '-'
        || lower(hex(randomblob(6))),          -- synthetic cuid-like id for the log row
    'system',
    'Role',
    CAST("id" AS TEXT),
    'id_type_migration',
    CURRENT_TIMESTAMP,
    json_object('oldIntId', "id", 'name', "name", 'migration', '20260715010000_role_id_to_cuid')
FROM "Role";

-- Step 2: recreate Role with TEXT primary key.
PRAGMA foreign_keys=OFF;

CREATE TABLE "Role_new" (
    "id"   TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- Copy existing rows, converting the integer id to its text representation.
-- This is deterministic and preserves referential transparency for any
-- application code that stored a Role id as a string (e.g. in JSON metadata).
INSERT INTO "Role_new" ("id", "name")
SELECT CAST("id" AS TEXT), "name"
FROM "Role";

DROP TABLE "Role";
ALTER TABLE "Role_new" RENAME TO "Role";

CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

PRAGMA foreign_keys=ON;

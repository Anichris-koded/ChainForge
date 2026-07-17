-- Drop existing AuditLog table if it exists
DROP TABLE IF EXISTS "AuditLog" CASCADE;

-- Create partitioned table by range
CREATE TABLE "AuditLogPartitioned" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AuditLogPartitioned_pkey" PRIMARY KEY ("id", "timestamp")
) PARTITION BY RANGE ("timestamp");

-- Pre-create partitions for past, current, and future months
-- Since we are in 2026, let's pre-create partitions for 2025, 2026, 2027, 2028, and a default fallback.

-- 2025 Partitions (Annual / Semi-annual / Monthly as needed; let's create monthly)
CREATE TABLE "AuditLog_y2025m01" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2025-01-01 00:00:00') TO ('2025-02-01 00:00:00');
CREATE TABLE "AuditLog_y2025m02" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2025-02-01 00:00:00') TO ('2025-03-01 00:00:00');
CREATE TABLE "AuditLog_y2025m03" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2025-03-01 00:00:00') TO ('2025-04-01 00:00:00');
CREATE TABLE "AuditLog_y2025m04" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2025-04-01 00:00:00') TO ('2025-05-01 00:00:00');
CREATE TABLE "AuditLog_y2025m05" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2025-05-01 00:00:00') TO ('2025-06-01 00:00:00');
CREATE TABLE "AuditLog_y2025m06" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2025-06-01 00:00:00') TO ('2025-07-01 00:00:00');
CREATE TABLE "AuditLog_y2025m07" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2025-07-01 00:00:00') TO ('2025-08-01 00:00:00');
CREATE TABLE "AuditLog_y2025m08" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2025-08-01 00:00:00') TO ('2025-09-01 00:00:00');
CREATE TABLE "AuditLog_y2025m09" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2025-09-01 00:00:00') TO ('2025-10-01 00:00:00');
CREATE TABLE "AuditLog_y2025m10" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2025-10-01 00:00:00') TO ('2025-11-01 00:00:00');
CREATE TABLE "AuditLog_y2025m11" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2025-11-01 00:00:00') TO ('2025-12-01 00:00:00');
CREATE TABLE "AuditLog_y2025m12" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2025-12-01 00:00:00') TO ('2026-01-01 00:00:00');

-- 2026 Partitions
CREATE TABLE "AuditLog_y2026m01" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2026-01-01 00:00:00') TO ('2026-02-01 00:00:00');
CREATE TABLE "AuditLog_y2026m02" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2026-02-01 00:00:00') TO ('2026-03-01 00:00:00');
CREATE TABLE "AuditLog_y2026m03" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2026-03-01 00:00:00') TO ('2026-04-01 00:00:00');
CREATE TABLE "AuditLog_y2026m04" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2026-04-01 00:00:00') TO ('2026-05-01 00:00:00');
CREATE TABLE "AuditLog_y2026m05" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2026-05-01 00:00:00') TO ('2026-06-01 00:00:00');
CREATE TABLE "AuditLog_y2026m06" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2026-06-01 00:00:00') TO ('2026-07-01 00:00:00');
CREATE TABLE "AuditLog_y2026m07" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2026-07-01 00:00:00') TO ('2026-08-01 00:00:00');
CREATE TABLE "AuditLog_y2026m08" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2026-08-01 00:00:00') TO ('2026-09-01 00:00:00');
CREATE TABLE "AuditLog_y2026m09" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2026-09-01 00:00:00') TO ('2026-10-01 00:00:00');
CREATE TABLE "AuditLog_y2026m10" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2026-10-01 00:00:00') TO ('2026-11-01 00:00:00');
CREATE TABLE "AuditLog_y2026m11" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2026-11-01 00:00:00') TO ('2026-12-01 00:00:00');
CREATE TABLE "AuditLog_y2026m12" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2026-12-01 00:00:00') TO ('2027-01-01 00:00:00');

-- 2027 Partitions
CREATE TABLE "AuditLog_y2027m01" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2027-01-01 00:00:00') TO ('2027-02-01 00:00:00');
CREATE TABLE "AuditLog_y2027m02" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2027-02-01 00:00:00') TO ('2027-03-01 00:00:00');
CREATE TABLE "AuditLog_y2027m03" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2027-03-01 00:00:00') TO ('2027-04-01 00:00:00');
CREATE TABLE "AuditLog_y2027m04" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2027-04-01 00:00:00') TO ('2027-05-01 00:00:00');
CREATE TABLE "AuditLog_y2027m05" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2027-05-01 00:00:00') TO ('2027-06-01 00:00:00');
CREATE TABLE "AuditLog_y2027m06" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2027-06-01 00:00:00') TO ('2027-07-01 00:00:00');
CREATE TABLE "AuditLog_y2027m07" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2027-07-01 00:00:00') TO ('2027-08-01 00:00:00');
CREATE TABLE "AuditLog_y2027m08" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2027-08-01 00:00:00') TO ('2027-09-01 00:00:00');
CREATE TABLE "AuditLog_y2027m09" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2027-09-01 00:00:00') TO ('2027-10-01 00:00:00');
CREATE TABLE "AuditLog_y2027m10" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2027-10-01 00:00:00') TO ('2027-11-01 00:00:00');
CREATE TABLE "AuditLog_y2027m11" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2027-11-01 00:00:00') TO ('2027-12-01 00:00:00');
CREATE TABLE "AuditLog_y2027m12" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2027-12-01 00:00:00') TO ('2028-01-01 00:00:00');

-- 2028 Partitions
CREATE TABLE "AuditLog_y2028m01" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2028-01-01 00:00:00') TO ('2028-02-01 00:00:00');
CREATE TABLE "AuditLog_y2028m02" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2028-02-01 00:00:00') TO ('2028-03-01 00:00:00');
CREATE TABLE "AuditLog_y2028m03" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2028-03-01 00:00:00') TO ('2028-04-01 00:00:00');
CREATE TABLE "AuditLog_y2028m04" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2028-04-01 00:00:00') TO ('2028-05-01 00:00:00');
CREATE TABLE "AuditLog_y2028m05" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2028-05-01 00:00:00') TO ('2028-06-01 00:00:00');
CREATE TABLE "AuditLog_y2028m06" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2028-06-01 00:00:00') TO ('2028-07-01 00:00:00');
CREATE TABLE "AuditLog_y2028m07" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2028-07-01 00:00:00') TO ('2028-08-01 00:00:00');
CREATE TABLE "AuditLog_y2028m08" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2028-08-01 00:00:00') TO ('2028-09-01 00:00:00');
CREATE TABLE "AuditLog_y2028m09" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2028-09-01 00:00:00') TO ('2028-10-01 00:00:00');
CREATE TABLE "AuditLog_y2028m10" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2028-10-01 00:00:00') TO ('2028-11-01 00:00:00');
CREATE TABLE "AuditLog_y2028m11" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2028-11-01 00:00:00') TO ('2028-12-01 00:00:00');
CREATE TABLE "AuditLog_y2028m12" PARTITION OF "AuditLogPartitioned" FOR VALUES FROM ('2028-12-01 00:00:00') TO ('2029-01-01 00:00:00');

-- Default partition fallback
CREATE TABLE "AuditLog_default" PARTITION OF "AuditLogPartitioned" DEFAULT;

-- Create indexes on partitioned table (they propagate to partitions)
CREATE INDEX "AuditLogPartitioned_entity_entityId_idx" ON "AuditLogPartitioned"("entity", "entityId");
CREATE INDEX "AuditLogPartitioned_timestamp_idx" ON "AuditLogPartitioned"("timestamp");
CREATE INDEX "AuditLogPartitioned_deletedAt_idx" ON "AuditLogPartitioned"("deletedAt");

-- Create view presentation matching original AuditLog table definition
CREATE VIEW "AuditLog" AS
SELECT "id", "actorId", "entity", "entityId", "action", "timestamp", "metadata", "deletedAt"
FROM "AuditLogPartitioned";

-- INSTEAD OF INSERT trigger function to route inserts to partitioned table
CREATE OR REPLACE FUNCTION audit_log_insert_trigger()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO "AuditLogPartitioned" ("id", "actorId", "entity", "entityId", "action", "timestamp", "metadata", "deletedAt")
    VALUES (NEW."id", NEW."actorId", NEW."entity", NEW."entityId", NEW."action", NEW."timestamp", NEW."metadata", NEW."deletedAt")
    RETURNING * INTO NEW;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_insert_trigger_tg
INSTEAD OF INSERT ON "AuditLog"
FOR EACH ROW
EXECUTE FUNCTION audit_log_insert_trigger();

-- INSTEAD OF UPDATE trigger function to route updates to partitioned table
CREATE OR REPLACE FUNCTION audit_log_update_trigger()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE "AuditLogPartitioned"
    SET "actorId" = NEW."actorId",
        "entity" = NEW."entity",
        "entityId" = NEW."entityId",
        "action" = NEW."action",
        "timestamp" = NEW."timestamp",
        "metadata" = NEW."metadata",
        "deletedAt" = NEW."deletedAt"
    WHERE "id" = OLD."id" AND "timestamp" = OLD."timestamp";
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_update_trigger_tg
INSTEAD OF UPDATE ON "AuditLog"
FOR EACH ROW
EXECUTE FUNCTION audit_log_update_trigger();

-- INSTEAD OF DELETE trigger function to route deletes to partitioned table
CREATE OR REPLACE FUNCTION audit_log_delete_trigger()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM "AuditLogPartitioned"
    WHERE "id" = OLD."id" AND "timestamp" = OLD."timestamp";
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_delete_trigger_tg
INSTEAD OF DELETE ON "AuditLog"
FOR EACH ROW
EXECUTE FUNCTION audit_log_delete_trigger();

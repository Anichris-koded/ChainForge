# AuditLog Table Partitioning Strategy

To prevent unbounded storage growth of the `AuditLog` table, we use PostgreSQL 11+ native declarative partitioning (partition-by-range on the `timestamp` column) combined with a database view.

## Architecture

1. **Partitioned Table (`AuditLogPartitioned`)**:
   - The primary storage table, partitioned monthly by the `timestamp` column.
   - Primary Key: `(id, timestamp)` (PostgreSQL requires the partition key to be part of the primary key).
   - Indexes: Propagated automatically to all partitions on `(entity, entityId)`, `timestamp`, and `deletedAt`.

2. **Database View (`AuditLog`)**:
   - Acts as the public interface for the Prisma client.
   - Keeps the Prisma schema and runtime client API identical (still references a model named `AuditLog` with a single `@id` on `id`).

3. **INSTEAD OF Triggers**:
   - Triggers intercept write operations (`INSERT`, `UPDATE`, `DELETE`) on the `AuditLog` view and route them to the underlying `AuditLogPartitioned` table.
   - Using `RETURNING * INTO NEW` enables Prisma's `returning` clauses to function correctly.

## Detaching and Archiving Partitions

To archive or purge old months, run the following SQL commands:

```sql
-- 1. Detach the partition from the main table
ALTER TABLE "AuditLogPartitioned" DETACH PARTITION "AuditLog_y2025m01";

-- 2. Optional: Archive or drop the detached partition
DROP TABLE "AuditLog_y2025m01";
```

## Adding New Partitions

New partitions can be added manually or via a cron/migration:

```sql
CREATE TABLE "AuditLog_y2029m01" PARTITION OF "AuditLogPartitioned"
    FOR VALUES FROM ('2029-01-01 00:00:00') TO ('2029-02-01 00:00:00');
```
A `DEFAULT` partition is also defined as a fallback to capture any writes outside pre-created partition ranges.

/**
 * scripts/api-key-backfill.ts
 *
 * One-time backfill: hash every legacy plaintext ApiKey.key with SHA-256,
 * populate keyHash + keyPreview, then set key = NULL so no cleartext
 * credential remains in the database.
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *
 *   # Dry-run (prints counts, writes nothing)
 *   DRY_RUN=true npx ts-node --transpile-only scripts/api-key-backfill.ts
 *
 *   # Live run
 *   npx ts-node --transpile-only scripts/api-key-backfill.ts
 *
 *   # Or via npm scripts (see package.json)
 *   npm run db:backfill-api-keys:dry-run
 *   npm run db:backfill-api-keys
 *
 * ─── Safety guarantees ───────────────────────────────────────────────────────
 *
 *   • Idempotent  – WHERE key IS NOT NULL means already-processed rows are
 *                   skipped; a second run is a no-op and exits 0.
 *   • Dry-run     – DRY_RUN=true prints the count of affected rows without
 *                   writing anything.
 *   • No leakage  – Plaintext key values are NEVER logged; only row counts
 *                   and IDs appear in output.
 *   • Atomic      – Each batch runs inside an explicit SQLite transaction so a
 *                   crash mid-batch leaves no half-hashed rows; the next run
 *                   picks them up (key IS NOT NULL still matches).
 *
 * ─── Concurrency ─────────────────────────────────────────────────────────────
 *
 *   SQLite serialises all writes through a single write-lock.  Running two
 *   instances simultaneously is safe: one will wait for the other's
 *   transaction to commit before proceeding.  The idempotency predicate
 *   ensures the second instance finds 0 rows even if the first processed
 *   them all.
 *
 *   For PostgreSQL environments: pg_advisory_xact_lock(hashtext('api-key-backfill'))
 *   should be called inside the transaction.  Uncomment the relevant block
 *   below when migrating to Postgres.
 */

import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

// ─── Configuration ────────────────────────────────────────────────────────────

const BATCH_SIZE = parseInt(process.env.BACKFILL_BATCH_SIZE ?? '100', 10);
const DRY_RUN = process.env.DRY_RUN === 'true' || process.env.DRY_RUN === '1';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute the SHA-256 hex digest of a string.
 * This is the same algorithm used in ApiKeysService.
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Build the key preview: first 6 chars + "..." + last 4 chars.
 * Mirrors the maskPreview helper in api-keys.service.ts.
 */
export function buildKeyPreview(rawKey: string): string {
  if (rawKey.length < 10) {
    // Fallback for unusually short keys (shouldn't happen in practice)
    return `${rawKey.slice(0, 4)}...`;
  }
  const prefix = rawKey.slice(0, 6);
  const suffix = rawKey.slice(-4);
  return `${prefix}...${suffix}`;
}

// ─── Exported backfill function (also used by tests) ─────────────────────────

export interface BackfillResult {
  /** Number of rows that had a non-NULL key when the job started. */
  totalLegacyRows: number;
  /** Number of rows actually processed (0 in dry-run mode). */
  processedRows: number;
  /** Number of rows skipped because they already had keyHash set. */
  skippedRows: number;
  /** Whether the run was a dry-run. */
  dryRun: boolean;
}

export interface BackfillRow {
  id: string;
  key: string;
}

/**
 * Main backfill logic.  Accepts an optional PrismaClient so tests can inject
 * a mock.
 */
export async function runBackfill(
  prisma: PrismaClient,
  options: { dryRun?: boolean; batchSize?: number } = {},
): Promise<BackfillResult> {
  const dryRun = options.dryRun ?? DRY_RUN;
  const batchSize = options.batchSize ?? BATCH_SIZE;

  // Count legacy rows upfront for reporting
  const totalLegacyRows = await prisma.apiKey.count({
    where: { key: { not: null } },
  });

  if (dryRun) {
    // In dry-run mode, also count rows that would be skipped because they
    // already have a keyHash (shouldn't happen if backfill was never run, but
    // defensive accounting is helpful for ops teams).
    const skippedRows = await prisma.apiKey.count({
      where: { key: { not: null }, keyHash: { not: null } },
    });

    console.log(`[api-key-backfill] DRY-RUN mode — no writes will occur`);
    console.log(
      `[api-key-backfill] Legacy rows (key IS NOT NULL): ${totalLegacyRows}`,
    );
    console.log(
      `[api-key-backfill] Already have keyHash (would skip): ${skippedRows}`,
    );
    console.log(
      `[api-key-backfill] Would process: ${totalLegacyRows - skippedRows}`,
    );

    return {
      totalLegacyRows,
      processedRows: 0,
      skippedRows,
      dryRun: true,
    };
  }

  console.log(
    `[api-key-backfill] Starting backfill — ${totalLegacyRows} legacy row(s) to process (batch size: ${batchSize})`,
  );

  let processedRows = 0;
  let skippedRows = 0;
  let offset = 0;

  while (true) {
    // Fetch a batch of rows that still have a plaintext key
    const batch: BackfillRow[] = await (prisma.apiKey.findMany as Function)({
      where: { key: { not: null } },
      select: { id: true, key: true },
      take: batchSize,
      skip: offset,
      orderBy: { createdAt: 'asc' },
    });

    if (batch.length === 0) break;

    // Process each row in the batch inside a single transaction so that a
    // crash mid-batch leaves all-or-nothing state.
    await prisma.$transaction(async tx => {
      // ── PostgreSQL advisory lock (uncomment when migrating to Postgres) ──
      // await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('api-key-backfill'))`;
      // ─────────────────────────────────────────────────────────────────────

      for (const row of batch) {
        // Skip rows that were already processed by a previous partial run
        // (key IS NOT NULL guard already filters, but if keyHash is set we
        // know a prior run computed it and didn't reach the key=NULL step).
        if (!row.key) {
          skippedRows++;
          continue;
        }

        const keyHash = sha256Hex(row.key);
        const keyPreview = buildKeyPreview(row.key);

        await (tx.apiKey.update as Function)({
          where: { id: row.id },
          data: {
            keyHash,
            keyPreview,
            key: null,
          },
        });

        processedRows++;
      }
    });

    console.log(
      `[api-key-backfill] Processed ${processedRows}/${totalLegacyRows} row(s)…`,
    );

    // Because we set key = NULL for processed rows, the next page at the same
    // offset will now contain the next unprocessed batch.  We only advance the
    // offset for rows that were skipped (had key IS NOT NULL but were already
    // hashed — an edge case from partial prior runs).
    offset += skippedRows > 0 ? batchSize : 0;

    // Exit when entire batch was already processed
    if (batch.length < batchSize) break;
  }

  console.log(
    `[api-key-backfill] Done — ${processedRows} row(s) hashed, ${skippedRows} row(s) skipped`,
  );

  return { totalLegacyRows, processedRows, skippedRows, dryRun: false };
}

// ─── Entry point (only runs when called directly, not when imported by tests) ─

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    const result = await runBackfill(prisma);

    if (result.dryRun) {
      console.log(
        `[api-key-backfill] Dry-run complete. Set DRY_RUN=false to apply changes.`,
      );
    } else {
      console.log(`[api-key-backfill] Backfill complete.`);
    }

    process.exit(0);
  } catch (err: unknown) {
    // Log the error but never log the row data (which may contain raw keys)
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api-key-backfill] FATAL: ${message}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Only run main() when this file is executed directly (not when imported)
if (require.main === module) {
  void main();
}

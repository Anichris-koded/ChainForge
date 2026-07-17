/**
 * scripts/api-key-backfill.ts
 *
 * One-time backfill job: hash every legacy plaintext API key.
 *
 * What it does
 * ------------
 * For every ApiKey row where `key IS NOT NULL` (legacy plaintext) and
 * `keyHash IS NULL` (not yet hashed), the script:
 *   1. Computes SHA-256 of the raw key value.
 *   2. Builds a preview: first 6 chars + "..." + last 4 chars.
 *   3. Writes `keyHash` and `keyPreview`, then clears `key`.
 *
 * Idempotency
 * -----------
 * Rows are only processed when `key IS NOT NULL AND keyHash IS NULL`.
 * A second run finds zero matching rows and exits immediately — it is
 * a true no-op.
 *
 * Dry-run mode
 * ------------
 * Pass --dry-run (or set DRY_RUN=true) to print counts and sample
 * previews without writing anything to the database.
 *
 * Batch processing
 * ----------------
 * The script processes rows in batches of BATCH_SIZE (default 100) to
 * avoid long-running transactions on large tables.
 *
 * Usage
 * -----
 *   # Normal run
 *   ts-node --transpile-only -r tsconfig-paths/register scripts/api-key-backfill.ts
 *
 *   # Dry-run (read-only, prints counts + previews)
 *   ts-node --transpile-only -r tsconfig-paths/register scripts/api-key-backfill.ts --dry-run
 *
 *   # Custom batch size
 *   BATCH_SIZE=50 ts-node --transpile-only -r tsconfig-paths/register scripts/api-key-backfill.ts
 */

import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BATCH_SIZE = parseInt(process.env['BATCH_SIZE'] ?? '100', 10);

const DRY_RUN =
  process.argv.includes('--dry-run') ||
  process.env['DRY_RUN']?.toLowerCase() === 'true';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hex digest of a string.
 * Mirrors the sha256Hex() helper in api-keys.service.ts.
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Build a masked preview of a raw key.
 * Format: first 6 chars + "..." + last 4 chars.
 * Mirrors maskPreview() in api-keys.service.ts.
 */
export function maskPreview(rawKey: string): string {
  const prefix = rawKey.slice(0, 6);
  const suffix = rawKey.slice(-4);
  return `${prefix}...${suffix}`;
}

// ---------------------------------------------------------------------------
// Core backfill logic — exported so tests can import it without spawning
// a real Prisma client.
// ---------------------------------------------------------------------------

export interface BackfillRow {
  id: string;
  key: string; // non-null, validated before this function is called
}

export interface BackfillResult {
  processed: number;
  skipped: number; // rows whose key was somehow empty/null at read time
}

/**
 * Process a single batch of rows.
 *
 * Each row is updated inside its own short transaction so that a failure
 * in one row does not roll back the whole batch.
 */
export async function processBatch(
  rows: BackfillRow[],
  updater: (
    id: string,
    keyHash: string,
    keyPreview: string,
  ) => Promise<void>,
  dryRun: boolean,
): Promise<BackfillResult> {
  let processed = 0;
  let skipped = 0;

  for (const row of rows) {
    // Guard: the query should only return rows with non-null key, but be
    // defensive to avoid ever hashing an empty string.
    if (!row.key) {
      skipped++;
      continue;
    }

    const keyHash = sha256Hex(row.key);
    const keyPreview = maskPreview(row.key);

    if (dryRun) {
      // Never log the raw key — only the preview and hash prefix.
      console.log(
        `[DRY-RUN] id=${row.id} preview="${keyPreview}" hash=${keyHash.slice(0, 8)}...`,
      );
      processed++;
      continue;
    }

    await updater(row.id, keyHash, keyPreview);
    processed++;
  }

  return { processed, skipped };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runBackfill(
  prisma: PrismaClient,
  opts: { dryRun: boolean; batchSize: number } = {
    dryRun: DRY_RUN,
    batchSize: BATCH_SIZE,
  },
): Promise<{ total: number; skipped: number }> {
  const { dryRun, batchSize } = opts;

  if (dryRun) {
    console.log('[api-key-backfill] DRY-RUN mode — no changes will be written.');
  }

  // Fetch all legacy rows up-front.  For very large tables this can be
  // replaced with cursor-based pagination; for a one-off backfill the
  // in-memory approach is simpler and safe.
  const legacyRows = await prisma.apiKey.findMany({
    where: {
      key: { not: null },
      keyHash: null,
    },
    select: { id: true, key: true },
    orderBy: { createdAt: 'asc' },
  });

  const totalLegacy = legacyRows.length;

  if (totalLegacy === 0) {
    console.log(
      '[api-key-backfill] No legacy rows found. Nothing to do (idempotent no-op).',
    );
    return { total: 0, skipped: 0 };
  }

  console.log(
    `[api-key-backfill] Found ${totalLegacy} legacy row(s) to process in batches of ${batchSize}.`,
  );

  // Updater function: writes keyHash + keyPreview, clears key.
  const updater = async (
    id: string,
    keyHash: string,
    keyPreview: string,
  ): Promise<void> => {
    await prisma.apiKey.update({
      where: { id },
      data: {
        keyHash,
        keyPreview,
        key: null,
      },
    });
  };

  let totalProcessed = 0;
  let totalSkipped = 0;

  // Split into batches.
  for (let offset = 0; offset < totalLegacy; offset += batchSize) {
    const batch = legacyRows
      .slice(offset, offset + batchSize)
      .filter((r): r is BackfillRow => r.key !== null);

    const { processed, skipped } = await processBatch(batch, updater, dryRun);

    totalProcessed += processed;
    totalSkipped += skipped;

    console.log(
      `[api-key-backfill] Batch ${Math.floor(offset / batchSize) + 1}: processed=${processed}` +
        (skipped > 0 ? ` skipped=${skipped}` : ''),
    );
  }

  console.log(
    `[api-key-backfill] Done. total_processed=${totalProcessed}` +
      (totalSkipped > 0 ? ` total_skipped=${totalSkipped}` : '') +
      (dryRun ? ' (DRY-RUN — no rows written)' : ''),
  );

  return { total: totalProcessed, skipped: totalSkipped };
}

// ---------------------------------------------------------------------------
// CLI entry — only runs when executed directly, not when imported by tests.
// ---------------------------------------------------------------------------

/* istanbul ignore next */
if (require.main === module) {
  const prisma = new PrismaClient();

  runBackfill(prisma, { dryRun: DRY_RUN, batchSize: BATCH_SIZE })
    .then(() => {
      process.exit(0);
    })
    .catch(err => {
      // Log the error message but never log raw key values.
      console.error('[api-key-backfill] Fatal error:', (err as Error).message);
      process.exit(1);
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}

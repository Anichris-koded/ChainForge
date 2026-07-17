/**
 * scripts/api-key-backfill.spec.ts
 *
 * Unit tests for the API-key backfill helpers and orchestration logic.
 * All Prisma calls are mocked — no real database is required.
 */

import { createHash } from 'node:crypto';
import {
  sha256Hex,
  maskPreview,
  processBatch,
  runBackfill,
  BackfillRow,
} from './api-key-backfill';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a minimal PrismaClient mock for runBackfill tests. */
function makePrismaMock(rows: Array<{ id: string; key: string | null }>) {
  return {
    apiKey: {
      findMany: jest.fn().mockResolvedValue(rows),
      update: jest.fn().mockResolvedValue({}),
    },
    $disconnect: jest.fn().mockResolvedValue(undefined),
  } as any;
}

// ---------------------------------------------------------------------------
// sha256Hex
// ---------------------------------------------------------------------------

describe('sha256Hex', () => {
  it('returns a 64-character hex string', () => {
    expect(sha256Hex('hello')).toHaveLength(64);
    expect(sha256Hex('hello')).toMatch(/^[0-9a-f]+$/);
  });

  it('matches the node:crypto reference output', () => {
    const expected = createHash('sha256').update('test-key-value').digest('hex');
    expect(sha256Hex('test-key-value')).toBe(expected);
  });

  it('produces different hashes for different inputs', () => {
    expect(sha256Hex('key-a')).not.toBe(sha256Hex('key-b'));
  });

  it('is deterministic — same input produces same output', () => {
    expect(sha256Hex('stable')).toBe(sha256Hex('stable'));
  });
});

// ---------------------------------------------------------------------------
// maskPreview
// ---------------------------------------------------------------------------

describe('maskPreview', () => {
  it('returns first-6 + "..." + last-4 format', () => {
    expect(maskPreview('s2s_abcdefghij1234')).toBe('s2s_ab...1234');
  });

  it('handles a key exactly 10 characters long (no overlap)', () => {
    expect(maskPreview('ABCDEF1234')).toBe('ABCDEF...1234');
  });

  it('never includes the middle portion of the key', () => {
    const raw = 's2s_XXXXXXXXXXX_XXXX';
    const preview = maskPreview(raw);
    // Preview must be prefix + separator + suffix only
    expect(preview).toBe(`${raw.slice(0, 6)}...${raw.slice(-4)}`);
  });

  it('matches the same logic as api-keys.service.ts', () => {
    const rawKey = 's2s_randomtoken123456';
    const expected = `${rawKey.slice(0, 6)}...${rawKey.slice(-4)}`;
    expect(maskPreview(rawKey)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// processBatch
// ---------------------------------------------------------------------------

describe('processBatch', () => {
  const rows: BackfillRow[] = [
    { id: 'r1', key: 'dev-admin-key-000' },
    { id: 'r2', key: 'dev-operator-key-001' },
  ];

  it('calls updater for each valid row in normal mode', async () => {
    const updater = jest.fn().mockResolvedValue(undefined);

    const result = await processBatch(rows, updater, false);

    expect(updater).toHaveBeenCalledTimes(2);
    expect(result.processed).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it('passes the correct hash and preview to updater', async () => {
    const updater = jest.fn().mockResolvedValue(undefined);

    await processBatch([rows[0]], updater, false);

    const [id, keyHash, keyPreview] = updater.mock.calls[0] as [
      string,
      string,
      string,
    ];

    expect(id).toBe('r1');
    expect(keyHash).toBe(sha256Hex('dev-admin-key-000'));
    expect(keyPreview).toBe(maskPreview('dev-admin-key-000'));
  });

  it('never calls updater in dry-run mode', async () => {
    const updater = jest.fn().mockResolvedValue(undefined);

    const result = await processBatch(rows, updater, true /* dryRun */);

    expect(updater).not.toHaveBeenCalled();
    expect(result.processed).toBe(2);
  });

  it('skips rows with an empty key', async () => {
    const badRows = [
      { id: 'r3', key: '' },
      { id: 'r4', key: 'good-key-abc' },
    ] as BackfillRow[];
    const updater = jest.fn().mockResolvedValue(undefined);

    const result = await processBatch(badRows, updater, false);

    expect(updater).toHaveBeenCalledTimes(1);
    expect(result.skipped).toBe(1);
    expect(result.processed).toBe(1);
  });

  it('does not log or pass raw key values to updater', async () => {
    const capturedHashes: string[] = [];
    const updater = jest.fn().mockImplementation(
      (_id: string, keyHash: string) => {
        capturedHashes.push(keyHash);
        return Promise.resolve();
      },
    );

    await processBatch([{ id: 'x', key: 'super-secret' }], updater, false);

    // The value passed to updater must be the hash, not the plaintext.
    expect(capturedHashes[0]).toBe(sha256Hex('super-secret'));
    expect(capturedHashes[0]).not.toBe('super-secret');
  });
});

// ---------------------------------------------------------------------------
// runBackfill
// ---------------------------------------------------------------------------

describe('runBackfill', () => {
  it('returns { total: 0, skipped: 0 } when no legacy rows exist', async () => {
    const prisma = makePrismaMock([]);

    const result = await runBackfill(prisma, { dryRun: false, batchSize: 100 });

    expect(result).toEqual({ total: 0, skipped: 0 });
    expect(prisma.apiKey.update).not.toHaveBeenCalled();
  });

  it('processes all legacy rows and writes the expected fields', async () => {
    const prisma = makePrismaMock([
      { id: 'k1', key: 'dev-admin-key-000' },
      { id: 'k2', key: 'dev-operator-key-001' },
    ]);

    const result = await runBackfill(prisma, { dryRun: false, batchSize: 100 });

    expect(result.total).toBe(2);
    expect(result.skipped).toBe(0);
    expect(prisma.apiKey.update).toHaveBeenCalledTimes(2);

    // Verify the payload for the first row.
    expect(prisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: 'k1' },
      data: {
        keyHash: sha256Hex('dev-admin-key-000'),
        keyPreview: maskPreview('dev-admin-key-000'),
        key: null,
      },
    });
  });

  it('is idempotent — a second run on an empty result set does nothing', async () => {
    // Simulate: first run processed everything → findMany returns []
    const prisma = makePrismaMock([]);

    const r1 = await runBackfill(prisma, { dryRun: false, batchSize: 100 });
    const r2 = await runBackfill(prisma, { dryRun: false, batchSize: 100 });

    expect(r1.total).toBe(0);
    expect(r2.total).toBe(0);
    expect(prisma.apiKey.update).not.toHaveBeenCalled();
  });

  it('does not call update in dry-run mode', async () => {
    const prisma = makePrismaMock([
      { id: 'k1', key: 'dev-admin-key-000' },
    ]);

    const result = await runBackfill(prisma, { dryRun: true, batchSize: 100 });

    expect(result.total).toBe(1);
    expect(prisma.apiKey.update).not.toHaveBeenCalled();
  });

  it('respects batchSize — splits rows across multiple batches', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `k${i}`,
      key: `key-value-${i}`,
    }));
    const prisma = makePrismaMock(rows);

    // Batch size of 2 → 3 batches (2 + 2 + 1)
    const result = await runBackfill(prisma, { dryRun: false, batchSize: 2 });

    expect(result.total).toBe(5);
    expect(prisma.apiKey.update).toHaveBeenCalledTimes(5);
  });

  it('clears the key column (sets it to null) after hashing', async () => {
    const prisma = makePrismaMock([{ id: 'k1', key: 'plaintext' }]);

    await runBackfill(prisma, { dryRun: false, batchSize: 100 });

    const callArg = (prisma.apiKey.update as jest.Mock).mock.calls[0][0];
    expect(callArg.data.key).toBeNull();
  });

  it('queries only rows where key is non-null and keyHash is null', async () => {
    const prisma = makePrismaMock([]);

    await runBackfill(prisma, { dryRun: false, batchSize: 100 });

    expect(prisma.apiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          key: { not: null },
          keyHash: null,
        },
      }),
    );
  });
});

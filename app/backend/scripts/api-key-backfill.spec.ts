/**
 * scripts/api-key-backfill.spec.ts
 *
 * Unit tests for the API key backfill script.
 *
 * All tests use an in-memory mock of PrismaClient so no database is required.
 * The mock faithfully simulates the row lifecycle: rows move from
 * key=plaintext → key=null as the backfill processes them.
 */

import { createHash } from 'node:crypto';
import {
  sha256Hex,
  buildKeyPreview,
  runBackfill,
  BackfillRow,
} from './api-key-backfill';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRow(id: string, key: string) {
  return { id, key };
}

/**
 * Build a minimal PrismaClient mock whose apiKey table is backed by a mutable
 * array.  Updates are applied in-memory so idempotency tests work correctly.
 */
function buildMockPrisma(initialRows: BackfillRow[]) {
  // Deep-copy so each test starts with an isolated dataset
  const rows: Array<{ id: string; key: string | null; keyHash: string | null; keyPreview: string | null }> =
    initialRows.map(r => ({ ...r, keyHash: null, keyPreview: null }));

  const apiKey = {
    count: jest.fn(({ where }: { where: any }) => {
      let matches = rows;
      if (where?.key?.not === null) {
        matches = matches.filter(r => r.key !== null);
      }
      if (where?.keyHash?.not === null) {
        matches = matches.filter(r => r.keyHash !== null);
      }
      return Promise.resolve(matches.length);
    }),

    findMany: jest.fn(
      ({
        where,
        take,
        skip = 0,
        orderBy,
      }: {
        where: any;
        take: number;
        skip?: number;
        orderBy?: any;
      }) => {
        let matches = rows;
        if (where?.key?.not === null) {
          matches = matches.filter(r => r.key !== null);
        }
        const page = matches.slice(skip, skip + take);
        return Promise.resolve(page);
      },
    ),

    update: jest.fn(
      ({
        where,
        data,
      }: {
        where: { id: string };
        data: { keyHash: string; keyPreview: string; key: null };
      }) => {
        const row = rows.find(r => r.id === where.id);
        if (!row) throw new Error(`Row ${where.id} not found`);
        row.keyHash = data.keyHash;
        row.keyPreview = data.keyPreview;
        row.key = data.key; // sets to null
        return Promise.resolve(row);
      },
    ),
  };

  // $transaction: execute the callback with a proxy that shares the same
  // in-memory rows so updates made inside the transaction are visible outside.
  const $transaction = jest.fn((fn: (tx: any) => Promise<any>) => {
    const txProxy = { apiKey };
    return fn(txProxy);
  });

  return {
    apiKey,
    $transaction,
    $disconnect: jest.fn().mockResolvedValue(undefined),
    // Expose the in-memory rows for assertion
    _rows: rows,
  };
}

// ─── sha256Hex ────────────────────────────────────────────────────────────────

describe('sha256Hex', () => {
  it('produces a 64-character hex string', () => {
    const result = sha256Hex('test-key');
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic', () => {
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'));
  });

  it('differs for different inputs', () => {
    expect(sha256Hex('key-a')).not.toBe(sha256Hex('key-b'));
  });

  it('matches the reference SHA-256 for a known value', () => {
    // echo -n "hello" | sha256sum
    const expected =
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
    expect(sha256Hex('hello')).toBe(expected);
  });
});

// ─── buildKeyPreview ──────────────────────────────────────────────────────────

describe('buildKeyPreview', () => {
  it('returns first-6 + "..." + last-4', () => {
    expect(buildKeyPreview('s2s_abcdefXXXXyyyy')).toBe('s2s_ab...yyyy');
  });

  it('handles the minimum-length boundary (≥10 chars)', () => {
    // Exactly 10 characters: "1234567890"
    expect(buildKeyPreview('1234567890')).toBe('123456...7890');
  });

  it('returns a truncated prefix for short keys (<10 chars)', () => {
    const preview = buildKeyPreview('short');
    expect(preview).toContain('...');
    expect(preview).toMatch(/^shor\.\.\./);
  });

  it('mirrors the maskPreview in api-keys.service.ts exactly', () => {
    const rawKey = 's2s_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const preview = buildKeyPreview(rawKey);
    expect(preview).toBe('s2s_AB...6789');
  });
});

// ─── runBackfill — dry-run mode ───────────────────────────────────────────────

describe('runBackfill — dry-run', () => {
  it('reports correct counts and writes nothing', async () => {
    const mockPrisma = buildMockPrisma([
      makeRow('r1', 'plain-key-1'),
      makeRow('r2', 'plain-key-2'),
    ]);

    const result = await runBackfill(mockPrisma as any, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.totalLegacyRows).toBe(2);
    expect(result.processedRows).toBe(0);

    // No rows should have been mutated
    expect(mockPrisma._rows[0].key).toBe('plain-key-1');
    expect(mockPrisma._rows[1].key).toBe('plain-key-2');
    expect(mockPrisma.apiKey.update).not.toHaveBeenCalled();
  });

  it('reports 0 rows when table is already clean', async () => {
    const mockPrisma = buildMockPrisma([]);

    const result = await runBackfill(mockPrisma as any, { dryRun: true });

    expect(result.totalLegacyRows).toBe(0);
    expect(result.processedRows).toBe(0);
  });
});

// ─── runBackfill — live run ───────────────────────────────────────────────────

describe('runBackfill — live run', () => {
  it('hashes every plaintext key and sets key = null', async () => {
    const rawKey = 's2s_testkey123456789';
    const mockPrisma = buildMockPrisma([makeRow('r1', rawKey)]);

    const result = await runBackfill(mockPrisma as any, { dryRun: false, batchSize: 100 });

    expect(result.processedRows).toBe(1);
    expect(result.dryRun).toBe(false);

    // Row should now have key = null and correct keyHash / keyPreview
    const row = mockPrisma._rows[0];
    expect(row.key).toBeNull();
    expect(row.keyHash).toBe(sha256Hex(rawKey));
    expect(row.keyPreview).toBe(buildKeyPreview(rawKey));
  });

  it('is idempotent — a second run processes 0 rows', async () => {
    const rawKey = 's2s_idempotent-key';
    const mockPrisma = buildMockPrisma([makeRow('r1', rawKey)]);

    // First run
    await runBackfill(mockPrisma as any, { dryRun: false, batchSize: 100 });

    const updateCallsAfterFirstRun = (mockPrisma.apiKey.update as jest.Mock).mock.calls.length;

    // Second run — the row now has key = null so it will not appear in
    // the findMany results (WHERE key IS NOT NULL)
    const result = await runBackfill(mockPrisma as any, { dryRun: false, batchSize: 100 });

    expect(result.totalLegacyRows).toBe(0);
    expect(result.processedRows).toBe(0);
    // update should not have been called again
    expect((mockPrisma.apiKey.update as jest.Mock).mock.calls.length).toBe(
      updateCallsAfterFirstRun,
    );
  });

  it('processes multiple rows across a batch', async () => {
    const keys = ['key-alpha', 'key-beta', 'key-gamma', 'key-delta'];
    const mockPrisma = buildMockPrisma(keys.map((k, i) => makeRow(`r${i}`, k)));

    const result = await runBackfill(mockPrisma as any, {
      dryRun: false,
      batchSize: 10,
    });

    expect(result.processedRows).toBe(4);
    mockPrisma._rows.forEach(row => {
      expect(row.key).toBeNull();
      expect(row.keyHash).toHaveLength(64);
      expect(row.keyPreview).toContain('...');
    });
  });

  it('processes rows in batches when batchSize < total rows', async () => {
    const keys = Array.from({ length: 5 }, (_, i) => `batch-key-${i}`);
    const mockPrisma = buildMockPrisma(keys.map((k, i) => makeRow(`r${i}`, k)));

    const result = await runBackfill(mockPrisma as any, {
      dryRun: false,
      batchSize: 2,
    });

    // All 5 rows should be processed regardless of batch size
    expect(result.processedRows).toBe(5);
    mockPrisma._rows.forEach(row => expect(row.key).toBeNull());
  });

  it('never logs plaintext key values', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const rawKey = 'super-secret-raw-key';
    const mockPrisma = buildMockPrisma([makeRow('r1', rawKey)]);

    await runBackfill(mockPrisma as any, { dryRun: false, batchSize: 100 });

    const allLogs = [
      ...logSpy.mock.calls.flat(),
      ...errorSpy.mock.calls.flat(),
    ].join(' ');

    expect(allLogs).not.toContain(rawKey);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('wraps each batch in a $transaction', async () => {
    const keys = ['tx-key-1', 'tx-key-2'];
    const mockPrisma = buildMockPrisma(keys.map((k, i) => makeRow(`r${i}`, k)));

    await runBackfill(mockPrisma as any, { dryRun: false, batchSize: 100 });

    // $transaction should have been called exactly once (one batch holds all rows)
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('produces keyHash that matches sha256Hex of the original key', async () => {
    const rawKey = 'dev-admin-key-000';
    const mockPrisma = buildMockPrisma([makeRow('r1', rawKey)]);

    await runBackfill(mockPrisma as any, { dryRun: false, batchSize: 100 });

    const row = mockPrisma._rows[0];
    expect(row.keyHash).toBe(
      createHash('sha256').update(rawKey).digest('hex'),
    );
  });

  it('exits cleanly when table has no legacy rows (no-op branch)', async () => {
    const mockPrisma = buildMockPrisma([]);

    const result = await runBackfill(mockPrisma as any, {
      dryRun: false,
      batchSize: 100,
    });

    expect(result.totalLegacyRows).toBe(0);
    expect(result.processedRows).toBe(0);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

// ─── Integration-style: seed.ts key derivation matches guard lookup ───────────

describe('hash consistency — seed vs guard', () => {
  /**
   * The seed inserts sha256Hex(rawKey) as keyHash.
   * The ApiKeyGuard hashes the incoming header value with the same algorithm.
   * If both use sha256Hex, they will always match.
   */
  const devKeys = [
    'dev-admin-key-000',
    'dev-operator-key-001',
    'dev-client-key-002',
    'dev-ngo-key-003',
  ];

  devKeys.forEach(rawKey => {
    it(`guard hash matches seed hash for "${rawKey}"`, () => {
      // Simulate seed: derive keyHash from rawKey
      const storedHash = sha256Hex(rawKey);

      // Simulate guard: hash the incoming API key header
      const incomingHash = createHash('sha256').update(rawKey).digest('hex');

      expect(storedHash).toBe(incomingHash);
    });
  });
});

/**
 * Error-envelope coverage matrix (issue #286).
 *
 * Static-analysis meta-test: verifies that every 4xx/5xx status code
 * documented in the committed OpenAPI spec (app/frontend/openapi.json,
 * kept fresh by CI's `spec:export` drift check) has a corresponding
 * envelope test in test/error-handling.e2e-spec.ts.
 *
 * Granularity is distinct status codes — not per-endpoint pairs — because
 * the envelope is produced by a single global filter
 * (src/common/filters/http-exception.filter.ts), so one test per status
 * proves the envelope shape for every endpoint returning that status.
 *
 * CONVENTION: this test detects tested statuses by scanning the e2e file
 * for literal `.expect(NNN)` calls. Tests using a variable status
 * (`.expect(status)`) are NOT counted — always assert with a literal.
 *
 * No app bootstrap, DB, or Redis required — pure file reading, safe under
 * the unit jest config (`npm test`) in CI.
 */
import * as fs from 'fs';
import * as path from 'path';

const OPENAPI_SPEC_PATH = path.resolve(
  __dirname,
  '../../frontend/openapi.json',
);
const E2E_SPEC_PATH = path.resolve(__dirname, 'error-handling.e2e-spec.ts');

function readOpenApiSpec(): Record<string, unknown> {
  if (!fs.existsSync(OPENAPI_SPEC_PATH)) {
    throw new Error(
      `OpenAPI spec not found at ${OPENAPI_SPEC_PATH}. ` +
        `Run \`npm run spec:export\` in app/backend to regenerate it.`,
    );
  }
  try {
    return JSON.parse(fs.readFileSync(OPENAPI_SPEC_PATH, 'utf8'));
  } catch (err) {
    throw new Error(
      `OpenAPI spec at ${OPENAPI_SPEC_PATH} is not valid JSON ` +
        `(${(err as Error).message}). Run \`npm run spec:export\` in app/backend.`,
    );
  }
}

/** Distinct 4xx/5xx statuses documented anywhere in the spec's paths. */
function collectDocumentedErrorStatuses(spec: Record<string, unknown>): {
  statuses: Set<number>;
  endpointsByStatus: Map<number, string[]>;
} {
  const statuses = new Set<number>();
  const endpointsByStatus = new Map<number, string[]>();
  const paths = (spec.paths ?? {}) as Record<
    string,
    Record<string, { responses?: Record<string, unknown> }>
  >;

  for (const [route, operations] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!operation || typeof operation !== 'object') continue;
      for (const statusKey of Object.keys(operation.responses ?? {})) {
        const status = Number(statusKey);
        if (Number.isInteger(status) && status >= 400 && status <= 599) {
          statuses.add(status);
          const endpoints = endpointsByStatus.get(status) ?? [];
          endpoints.push(`${method.toUpperCase()} ${route}`);
          endpointsByStatus.set(status, endpoints);
        }
      }
    }
  }
  return { statuses, endpointsByStatus };
}

/** Statuses asserted via literal `.expect(NNN)` calls in the e2e spec. */
function collectTestedStatuses(): Set<number> {
  if (!fs.existsSync(E2E_SPEC_PATH)) {
    throw new Error(`Envelope e2e spec not found at ${E2E_SPEC_PATH}.`);
  }
  const source = fs
    .readFileSync(E2E_SPEC_PATH, 'utf8')
    // Strip comments so status codes mentioned in docs don't count as tested
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const tested = new Set<number>();
  for (const match of source.matchAll(/\.expect\((\d{3})\)/g)) {
    tested.add(Number(match[1]));
  }
  return tested;
}

describe('Error-envelope coverage matrix', () => {
  it('every documented 4xx/5xx status has an envelope test in error-handling.e2e-spec.ts', () => {
    const spec = readOpenApiSpec();
    const { statuses: documented, endpointsByStatus } =
      collectDocumentedErrorStatuses(spec);
    const tested = collectTestedStatuses();

    expect(documented.size).toBeGreaterThan(0);

    const missing = [...documented]
      .filter(status => !tested.has(status))
      .sort((a, b) => a - b);

    if (missing.length > 0) {
      const detail = missing
        .map(status => {
          const endpoints = endpointsByStatus.get(status) ?? [];
          const sample = endpoints.slice(0, 3).join(', ');
          const more =
            endpoints.length > 3 ? ` (+${endpoints.length - 3} more)` : '';
          return `  - ${status} — documented on: ${sample}${more}`;
        })
        .join('\n');
      throw new Error(
        `Documented error status(es) with no envelope test in ` +
          `test/error-handling.e2e-spec.ts:\n${detail}\n\n` +
          `Add a test asserting the global error envelope with a LITERAL ` +
          `status (e.g. \`.expect(${missing[0]})\`) — variable statuses are ` +
          `not detected by this matrix.`,
      );
    }
  });
});

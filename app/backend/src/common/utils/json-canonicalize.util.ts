/**
 * Canonical JSON stringification.
 *
 * Produces a deterministic string representation of a JSON-like value so
 * that two structurally equivalent values with different key order yield
 * the same output. Used by the HTTP cache interceptor to compute strong
 * ETags that don't churn on cosmetic reordering by upstream serializer
 * passes.
 *
 * Semantics:
 * - Primitives use the built-in JSON.stringify rules.
 * - `Date` instances are serialized to ISO 8601 strings.
 * - `null` is serialized as `null`.
 * - Object keys are sorted alphabetically at every depth.
 * - Array order is preserved (arrays are not sorted — they have meaning).
 * - Circular references fall back to a sentinel string so we never throw.
 */
export function canonicalStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const visit = (input: unknown): string => {
    if (input === null || input === undefined) return 'null';

    const type = typeof input;

    if (type === 'string') return JSON.stringify(input);
    if (type === 'number') {
      // JSON.stringify emits NaN/Infinity as null; replicate to be explicit.
      const n = input as number;
      if (!Number.isFinite(n)) return 'null';
      return JSON.stringify(n);
    }
    if (type === 'boolean') return JSON.stringify(input);

    if (input instanceof Date) {
      return JSON.stringify(input.toISOString());
    }

    if (typeof input === 'bigint') {
      // JSON.stringify throws on bigint by default; emit as a string
      // so ETag computation doesn't crash on Stellar amounts / NGO IDs.
      return JSON.stringify(input.toString());
    }

    if (Array.isArray(input)) {
      return `[${input.map(visit).join(',')}]`;
    }

    if (type === 'object') {
      const obj = input as Record<string, unknown>;
      if (seen.has(obj)) return '"[Circular]"';
      seen.add(obj);

      const keys = Object.keys(obj).sort();
      const parts: string[] = [];
      for (const key of keys) {
        parts.push(`${JSON.stringify(key)}:${visit(obj[key])}`);
      }
      return `{${parts.join(',')}}`;
    }

    // Functions, symbols, undefined nested in objects, etc. — fall back
    // to JSON.stringify behavior. JSON.stringify never returns `null`
    // for valid input, so we keep the `?? 'null'` for safety with
    // possible `JSON.stringify(undefined) === undefined`.
    return JSON.stringify(input as string | number | boolean | null) ?? 'null';
  };

  return visit(value);
}

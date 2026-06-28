/**
 * Helpers for coercing values decoded from Soroban contract / RPC responses.
 *
 * Those values arrive typed as `unknown`, so calling `String()` on them
 * directly risks `[object Object]` output (and trips
 * `@typescript-eslint/no-base-to-string`). These helpers only stringify
 * primitive values and fall back otherwise.
 */

/**
 * Coerces an unknown contract value to a string, returning `fallback` for
 * null/undefined or any non-primitive (object/array/function) value.
 */
export function toContractString(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return fallback;
}

/**
 * Coerces an unknown value into a `Record<string, string>`, keeping only
 * entries whose value is a string. Returns `undefined` when the input is not
 * an object.
 */
export function toStringRecord(
  value: unknown,
): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === 'string') {
      out[key] = val;
    }
  }
  return out;
}

import { canonicalStringify } from '../json-canonicalize.util';

describe('canonicalStringify', () => {
  it('serializes primitives', () => {
    expect(canonicalStringify(null)).toBe('null');
    expect(canonicalStringify(undefined)).toBe('null');
    expect(canonicalStringify('hello')).toBe('"hello"');
    expect(canonicalStringify(42)).toBe('42');
    expect(canonicalStringify(true)).toBe('true');
    expect(canonicalStringify(false)).toBe('false');
  });

  it('replaces non-finite numbers with null', () => {
    expect(canonicalStringify(Number.NaN)).toBe('null');
    expect(canonicalStringify(Number.POSITIVE_INFINITY)).toBe('null');
    expect(canonicalStringify(Number.NEGATIVE_INFINITY)).toBe('null');
  });

  it('serializes Date to ISO string', () => {
    const iso = '2025-01-02T03:04:05.000Z';
    expect(canonicalStringify(new Date(iso))).toBe(JSON.stringify(iso));
  });

  it('sorts object keys for determinism', () => {
    const a = { b: 1, a: 2, c: { y: 1, x: 2 } };
    const b = { c: { x: 2, y: 1 }, a: 2, b: 1 };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it('preserves array order', () => {
    const a = canonicalStringify([1, 2, 3]);
    const b = canonicalStringify([3, 2, 1]);
    expect(a).not.toBe(b);
  });

  it('handles circular references safely', () => {
    const obj: Record<string, unknown> = { name: 'root' };
    obj.self = obj;
    const result = canonicalStringify(obj);
    expect(result).toContain('"[Circular]"');
  });

  it('serializes nested structures', () => {
    const value = { list: [{ id: 1 }, { id: 2 }], count: 2 };
    expect(canonicalStringify(value)).toBe(
      '{"count":2,"list":[{"id":1},{"id":2}]}',
    );
  });
});

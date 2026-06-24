import 'reflect-metadata';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, of, throwError } from 'rxjs';
import { HttpCacheInterceptor } from '../http-cache.interceptor';
import {
  HTTP_CACHE_METADATA,
  HTTP_CACHE_SKIP,
} from '../../decorators/http-cache.decorator';

interface FakeResponse {
  headers: Record<string, string>;
  statusCode: number;
  status(code: number): FakeResponse;
  setHeader(name: string, value: string | number): void;
  getHeader(name: string): string | undefined;
  removeHeader(name: string): void;
}

const createResponse = (): FakeResponse => {
  const headers: Record<string, string> = {};
  return {
    headers,
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string | number) {
      headers[name.toLowerCase()] = String(value);
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    removeHeader(name: string) {
      delete headers[name.toLowerCase()];
    },
  };
};

const decorated = (key: string, value: unknown) => {
  const fn: (...args: unknown[]) => unknown = (..._args: unknown[]) =>
    undefined;
  Reflect.defineMetadata(key, value, fn);
  return fn;
};

const createContext = ({
  method = 'GET',
  path = '/api/v1/campaigns',
  handler = decorated(HTTP_CACHE_SKIP, false),
  controller = class {},
  ifNoneMatch,
}: {
  method?: string;
  path?: string;
  handler?: object;
  controller?: object;
  ifNoneMatch?: string;
}): { context: ExecutionContext; response: FakeResponse } => {
  const headers: Record<string, string> = {};
  if (ifNoneMatch !== undefined) headers['if-none-match'] = ifNoneMatch;

  const request = {
    method,
    path,
    baseUrl: '',
    url: path,
    originalUrl: path,
    headers,
  };
  const response = createResponse();

  const context: ExecutionContext = {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;

  return { context, response };
};

describe('HttpCacheInterceptor', () => {
  const configGet = jest.fn();
  const reflector = new Reflector();

  const buildInterceptor = () =>
    new HttpCacheInterceptor(reflector, {
      get: configGet,
    } as unknown as ConfigService);

  beforeEach(() => {
    configGet.mockReset();
  });

  describe('global enable / disable', () => {
    it('passes through when HTTP_CACHE_ENABLED=false', async () => {
      configGet.mockImplementation((key: string) =>
        key === 'HTTP_CACHE_ENABLED' ? 'false' : undefined,
      );
      const { context, response } = createContext({});
      const next: CallHandler = { handle: () => of({ a: 1 }) };
      const result = await firstValueFrom(
        buildInterceptor().intercept(context, next),
      );

      expect(result).toEqual({ a: 1 });
      expect(response.statusCode).toBe(200);
      expect(response.getHeader('ETag')).toBeUndefined();
      expect(response.getHeader('Cache-Control')).toBeUndefined();
    });
  });

  describe('mutating methods', () => {
    it('sets Cache-Control: no-store + Pragma: no-cache on POST/PUT/PATCH/DELETE', async () => {
      configGet.mockReturnValue(undefined);
      const interceptor = buildInterceptor();

      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const { context, response } = createContext({ method });
        const next: CallHandler = { handle: () => of({}) };
        await firstValueFrom(interceptor.intercept(context, next));
        expect(response.getHeader('Cache-Control')).toBe('no-store');
        expect(response.getHeader('Pragma')).toBe('no-cache');
      }
    });

    it('skips the debug header in production', async () => {
      configGet.mockImplementation((key: string) =>
        key === 'NODE_ENV' ? 'production' : undefined,
      );
      const interceptor = buildInterceptor();
      const { context, response } = createContext({ method: 'POST' });
      await firstValueFrom(
        interceptor.intercept(context, { handle: () => of({}) }),
      );
      expect(response.getHeader('X-Http-Cache')).toBeUndefined();
    });

    it('still applies no-store on a path that is otherwise always-skipped', async () => {
      configGet.mockReturnValue(undefined);
      const interceptor = buildInterceptor();
      const { context, response } = createContext({
        method: 'POST',
        path: '/api/docs',
      });
      await firstValueFrom(
        interceptor.intercept(context, { handle: () => of({}) }),
      );
      expect(response.getHeader('Cache-Control')).toBe('no-store');
      expect(response.getHeader('Pragma')).toBe('no-cache');
    });

    it('overrides Cache-Control to no-store when the controller throws', async () => {
      configGet.mockReturnValue(undefined);
      const interceptor = buildInterceptor();

      for (const method of ['GET', 'HEAD']) {
        const { context, response } = createContext({ method });
        const error = new Error('boom');
        await expect(
          firstValueFrom(
            interceptor.intercept(context, {
              handle: () => throwError(() => error),
            }),
          ),
        ).rejects.toBe(error);

        expect(response.getHeader('Cache-Control')).toBe('no-store');
        expect(response.getHeader('Pragma')).toBe('no-cache');
        expect(response.getHeader('ETag')).toBeUndefined();
        // Pre-set Vary is now stripped: an error response should not
        // tell intermediaries to partition by Authorization on a cache
        // that will never be consulted (cache control is no-store).
        expect(response.getHeader('Vary')).toBeUndefined();
      }
    });

    it('OPTIONS requests are passed through (correct CORS preflight behavior; HEAD is covered below)', async () => {
      configGet.mockReturnValue(undefined);
      const interceptor = buildInterceptor();
      for (const method of ['OPTIONS']) {
        const { context, response } = createContext({ method });
        const next: CallHandler = { handle: () => of({}) };
        await firstValueFrom(interceptor.intercept(context, next));
        expect(response.getHeader('Cache-Control')).toBeUndefined();
        expect(response.getHeader('ETag')).toBeUndefined();
        expect(response.getHeader('Vary')).toBeUndefined();
      }
    });

    it('HEAD also receives Cache-Control + ETag', async () => {
      configGet.mockReturnValue(undefined);
      const interceptor = buildInterceptor();
      const { context, response } = createContext({ method: 'HEAD' });
      await firstValueFrom(
        interceptor.intercept(context, { handle: () => of({ id: 1 }) }),
      );
      expect(response.getHeader('Cache-Control')).toBe(
        'private, must-revalidate',
      );
      expect(response.getHeader('Vary')).toBe(
        'Authorization, Accept-Encoding',
      );
      expect(response.getHeader('ETag')).toMatch(/^"[a-f0-9]{64}"$/);
    });

    it('HEAD with matching If-None-Match returns 304', async () => {
      configGet.mockReturnValue(undefined);
      const interceptor = buildInterceptor();

      const first = createContext({ method: 'HEAD' });
      await firstValueFrom(
        interceptor.intercept(first.context, { handle: () => of({ id: 1 }) }),
      );
      const tag = first.response.getHeader('ETag') as string;

      const second = createContext({
        method: 'HEAD',
        ifNoneMatch: tag,
      });
      const body = await firstValueFrom(
        interceptor.intercept(second.context, { handle: () => of({ id: 1 }) }),
      );
      expect(second.response.statusCode).toBe(304);
      expect(body).toBeUndefined();
    });
  });

  describe('GET request headers', () => {
    it('sets private, must-revalidate by default', async () => {
      configGet.mockReturnValue(undefined);
      const interceptor = buildInterceptor();
      const { context, response } = createContext({});
      await firstValueFrom(
        interceptor.intercept(context, { handle: () => of({ id: 1 }) }),
      );
      expect(response.getHeader('Cache-Control')).toBe(
        'private, must-revalidate',
      );
      expect(response.getHeader('Vary')).toBe(
        'Authorization, Accept-Encoding',
      );
      expect(response.getHeader('ETag')).toMatch(/^"[a-f0-9]{64}"$/);
      expect(response.getHeader('X-Http-Cache')).toBe('miss');
    });

    it('emits deterministic ETags across key reorderings', async () => {
      configGet.mockReturnValue(undefined);
      const interceptor = buildInterceptor();

      const firstCtx = createContext({});
      const first = await firstValueFrom(
        interceptor.intercept(firstCtx.context, {
          handle: () => of({ z: 1, a: 2, m: { y: 1, x: 2 } }),
        }),
      );
      const firstTag = firstCtx.response.getHeader('ETag') as string;

      const secondCtx = createContext({ path: '/api/v1/y' });
      const second = await firstValueFrom(
        interceptor.intercept(secondCtx.context, {
          handle: () => of({ a: 2, m: { x: 2, y: 1 }, z: 1 }),
        }),
      );
      const secondTag = secondCtx.response.getHeader('ETag') as string;

      expect(first).toEqual(second);
      expect(firstTag).toBeTruthy();
      expect(firstTag).toBe(secondTag);
    });

    it('handles responses containing BigInt without throwing', async () => {
      configGet.mockReturnValue(undefined);
      const interceptor = buildInterceptor();
      const { context, response } = createContext({});
      await firstValueFrom(
        interceptor.intercept(context, {
          handle: () => of({ big: 1125899906842621n }),
        }),
      );
      expect(response.getHeader('ETag')).toMatch(/^"[a-f0-9]{64}"$/);
    });

    it('hashes primitive response bodies (string, number, boolean, null)', async () => {
      configGet.mockReturnValue(undefined);
      const interceptor = buildInterceptor();

      const cases: Array<{ label: string; payload: unknown }> = [
        { label: 'string', payload: 'hello' },
        { label: 'number', payload: 42 },
        { label: 'zero', payload: 0 },
        { label: 'boolean', payload: true },
        { label: 'null', payload: null },
      ];

      for (const { payload } of cases) {
        const { context, response } = createContext({
          path: `/api/v1/primitive-${String(payload)}`,
        });
        const result = await firstValueFrom(
          interceptor.intercept(context, { handle: () => of(payload) }),
        );
        expect(result).toBe(payload);
        expect(response.getHeader('Cache-Control')).toBe(
          'private, must-revalidate',
        );
        expect(response.getHeader('ETag')).toMatch(/^"[a-f0-9]{64}"$/);
      }
    });

    it('skips ETag when Content-Type is set to a non-JSON value', async () => {
      configGet.mockReturnValue(undefined);
      const interceptor = buildInterceptor();
      const { context, response } = createContext({});
      // Simulate `@Header('Content-Type', 'text/plain')` on the handler.
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      await firstValueFrom(
        interceptor.intercept(context, { handle: () => of({ id: 1 }) }),
      );
      expect(response.getHeader('ETag')).toBeUndefined();
      // Cache-Control still emitted; the handler opted out of ETag only.
      expect(response.getHeader('Cache-Control')).toBe(
        'private, must-revalidate',
      );
    });

    describe('If-None-Match parsing', () => {
      const expect304 = async (
        ifNoneMatch: string,
        payload: unknown = { id: 1 },
      ): Promise<{ status: number; etag: string | undefined }> => {
        configGet.mockReturnValue(undefined);

        // First call: get the ETag.
        const seeded = createContext({});
        const seedInterceptor = buildInterceptor();
        await firstValueFrom(
          seedInterceptor.intercept(seeded.context, {
            handle: () => of(payload),
          }),
        );
        const tag = seeded.response.getHeader('ETag') as string;

        const next = createContext({
          ifNoneMatch: ifNoneMatch.replace('__TAG__', tag),
        });
        const result = await firstValueFrom(
          buildInterceptor().intercept(next.context, {
            handle: () => of(payload),
          }),
        );
        expect(result).toBeUndefined();
        return { status: next.response.statusCode, etag: next.response.getHeader('ETag') };
      };

      it('returns 304 on exact strong ETag match', async () => {
        const { status, etag } = await expect304('__TAG__');
        expect(status).toBe(304);
        expect(etag).toBeDefined();
      });

      it('returns 304 for If-None-Match: *', async () => {
        const { status } = await expect304('*');
        expect(status).toBe(304);
      });

      it('returns 304 for W/-prefixed weak tag', async () => {
        const { status } = await expect304('W/__TAG__');
        expect(status).toBe(304);
      });

      it('returns 304 for comma-separated multi-value list', async () => {
        const { status } = await expect304('"old", __TAG__, "another"');
        expect(status).toBe(304);
      });

      it('does not 304 when If-None-Match does not match', async () => {
        configGet.mockReturnValue(undefined);
        const seeded = createContext({});
        await firstValueFrom(
          buildInterceptor().intercept(seeded.context, {
            handle: () => of({ id: 1 }),
          }),
        );

        const next = createContext({ ifNoneMatch: '"does-not-exist"' });
        const result = await firstValueFrom(
          buildInterceptor().intercept(next.context, {
            handle: () => of({ id: 1 }),
          }),
        );
        expect(next.response.statusCode).toBe(200);
        expect(result).toEqual({ id: 1 });
      });
    });

    it('honours HttpCacheTtl decorator', async () => {
      configGet.mockReturnValue(undefined);
      const interceptor = buildInterceptor();
      const handler = decorated(HTTP_CACHE_METADATA, { ttl: 120 });
      const { context, response } = createContext({ handler });
      await firstValueFrom(
        interceptor.intercept(context, { handle: () => of({ id: 1 }) }),
      );
      expect(response.getHeader('Cache-Control')).toBe(
        'private, max-age=120, must-revalidate',
      );
    });

    it('honours @HttpCache({ public: true })', async () => {
      configGet.mockReturnValue(undefined);
      const interceptor = buildInterceptor();
      const handler = decorated(HTTP_CACHE_METADATA, { public: true });
      const { context, response } = createContext({ handler });
      await firstValueFrom(
        interceptor.intercept(context, { handle: () => of({ ok: 1 }) }),
      );
      expect(response.getHeader('Cache-Control')).toBe('public');
    });

    it('honours @SkipHttpCache', async () => {
      configGet.mockReturnValue(undefined);
      const interceptor = buildInterceptor();
      const handler = decorated(HTTP_CACHE_SKIP, true);
      const { context, response } = createContext({ handler });
      const result = await firstValueFrom(
        interceptor.intercept(context, { handle: () => of({ a: 1 }) }),
      );
      expect(result).toEqual({ a: 1 });
      expect(response.getHeader('Cache-Control')).toBeUndefined();
      expect(response.getHeader('ETag')).toBeUndefined();
    });

    it('skips Swagger / docs paths on GET (no Cache-Control emitted)', async () => {
      configGet.mockReturnValue(undefined);
      const interceptor = buildInterceptor();
      for (const path of [
        '/api/docs',
        '/api/v1/docs',
        '/api/v2/docs/anything',
        '/api/v1/deprecated-test',
      ]) {
        const { context, response } = createContext({ path });
        await firstValueFrom(
          interceptor.intercept(context, { handle: () => of({}) }),
        );
        expect(response.getHeader('Cache-Control')).toBeUndefined();
        expect(response.getHeader('ETag')).toBeUndefined();
      }
    });

    it('passes streams / buffers / StreamableFile-shaped values through', async () => {
      configGet.mockReturnValue(undefined);
      const interceptor = buildInterceptor();

      const cases = [
        { kind: 'node stream', value: { pipe: jest.fn() } },
        {
          kind: 'web stream',
          value: {
            pipeTo: jest.fn(),
            [Symbol.asyncIterator]: jest.fn(),
          } as unknown,
        },
        { kind: 'buffer', value: Buffer.from('hi') },
        { kind: 'uint8array', value: new Uint8Array([1, 2, 3]) },
      ];

      for (const { value } of cases) {
        const { context, response } = createContext({
          path: '/api/v1/download',
        });
        const result = await firstValueFrom(
          interceptor.intercept(context, { handle: () => of(value) }),
        );
        expect(result).toBe(value);
        expect(response.getHeader('ETag')).toBeUndefined();
        expect(response.getHeader('Cache-Control')).toBe(
          'private, must-revalidate',
        );
      }
    });
  });
});

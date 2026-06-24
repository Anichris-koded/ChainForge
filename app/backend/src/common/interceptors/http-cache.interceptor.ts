import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { canonicalStringify } from '../utils/json-canonicalize.util';
import {
  HTTP_CACHE_METADATA,
  HTTP_CACHE_SKIP,
  HttpCacheOptions,
} from '../decorators/http-cache.decorator';

/**
 * Maximum size (bytes) for which we compute an ETag. Larger payloads
 * skip ETag generation but still get Cache-Control.
 */
const MAX_ETAG_PAYLOAD_BYTES = 256 * 1024; // 256 KB

/**
 * Path prefixes that always skip HTTP caching regardless of decorators.
 * These endpoints serve documentation, test fixtures, or live signals
 * that must never be stored by an intermediary.
 */
const SKIP_PATH_PREFIXES: readonly string[] = [
  '/api/docs',
  '/api/v1/docs',
  '/api/v2/docs',
  '/api/v1/deprecated-test',
];

/**
 * HTTP methods considered safe to cache responses from. Per RFC 7231
 * GET and HEAD are the canonical safe methods; we treat them equally
 * so that CDN revalidation HEAD probes benefit from the same
 * Cache-Control / ETag surface as the original GET.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD']);

/**
 * HTTP methods whose responses must never be persisted by any cache
 * because they describe server-side state changes (idempotent or not).
 */
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * HttpCacheInterceptor
 *
 * Adds RFC 7232-compliant caching headers to GET / HEAD responses and
 * `Cache-Control: no-store` to mutation responses. The interceptor is
 * intentionally conservative:
 *
 *   - Successful GET / HEAD responses receive:
 *       * `ETag`            — strong validator derived from the
 *                              canonical JSON body so cosmetic
 *                              reordering does not invalidate the
 *                              cache.
 *       * `Cache-Control`   — `private, must-revalidate` by default
 *                              to prevent shared caches from
 *                              accidentally serving auth-scoped
 *                              data; tunable per handler.
 *       * `Vary`            — `Authorization, Accept-Encoding` so
 *                              caches partition by identity and
 *                              content encoding.
 *   - Mutation responses (POST/PUT/PATCH/DELETE) receive
 *     `Cache-Control: no-store` (with an HTTP/1.0 `Pragma: no-cache`
 *     fallback) so intermediaries do not persist them between
 *     requests, regardless of route or decorators.
 *   - When the controller throws, we override the pre-set Cache-Control
 *     with `no-store` + `Pragma: no-cache` so 4xx / 5xx responses are
 *     never cached by a CDN, even though the interceptor's
 *     pre-handler pass set `private, must-revalidate`.
 *   - When the client supplies `If-None-Match` matching the freshly
 *     computed ETag, the handler payload short-circuits and is
 *     replaced with an empty `304 Not Modified` response, leaving the
 *     ETag / Cache-Control headers in place.
 *
 * The interceptor does NOT mutate anything when:
 *   - The global `HTTP_CACHE_ENABLED` flag is `false`.
 *   - The decorated handler/controller uses `@SkipHttpCache()`.
 *   - The matched path begins with a skippable prefix (e.g. Swagger
 *     docs, the deprecation test endpoint).
 *   - The body is a stream (Node Readable / Web ReadableStream /
 *     NestJS `StreamableFile` / `Buffer`) so binary downloads remain
 *     untouched.
 *   - The response Content-Type is set to a non-JSON value already.
 */
@Injectable()
export class HttpCacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpCacheInterceptor.name);
  private readonly enabled: boolean;
  private readonly defaultTtl: number;
  private readonly maxPayloadBytes: number;
  private readonly debugHeaders: boolean;

  constructor(
    private readonly reflector: Reflector,
    configService: ConfigService,
  ) {
    this.enabled = (configService.get<string>('HTTP_CACHE_ENABLED') ?? 'true')
      .toLowerCase()
      !== 'false';

    const ttlRaw = configService.get<string>('HTTP_CACHE_DEFAULT_TTL');
    const parsedTtl = ttlRaw !== undefined ? Number.parseInt(ttlRaw, 10) : NaN;
    // NaN (not 0) when unset OR set to zero so that handlers without an
    // explicit TTL do not silently emit `no-cache`. The maintainer contract
    // is that an explicit `@HttpCacheTtl(0)` is the ONLY opt-in to
    // `no-cache` — `HTTP_CACHE_DEFAULT_TTL=0` would otherwise leak that
    // opt-in to every unannotated handler.
    this.defaultTtl =
      Number.isFinite(parsedTtl) && parsedTtl > 0 ? parsedTtl : NaN;

    const maxRaw = configService.get<string>('HTTP_CACHE_MAX_ETAG_BYTES');
    const parsedMax = maxRaw !== undefined ? Number.parseInt(maxRaw, 10) : NaN;
    this.maxPayloadBytes =
      Number.isFinite(parsedMax) && parsedMax > 0
        ? parsedMax
        : MAX_ETAG_PAYLOAD_BYTES;

    this.debugHeaders =
      (configService.get<string>('NODE_ENV') ?? 'development') !==
      'production';
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.enabled) {
      return next.handle();
    }

    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();
    const requestMethod = (request.method ?? '').toUpperCase();

    // Mutations ALWAYS get `Cache-Control: no-store` first — this fires
    // before any skip-path or `@SkipHttpCache` decorator check because
    // mutating endpoints must never end up in a shared cache, even if
    // mounted on a path we normally skip (e.g. a docs handler that
    // accepts test mutations). RFC 7234 §5.5: also emit Pragma for
    // HTTP/1.0 intermediaries.
    if (MUTATION_METHODS.has(requestMethod)) {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Pragma', 'no-cache');
      return next.handle();
    }

    if (this.shouldAlwaysSkip(request)) {
      return next.handle();
    }

    const skip = this.reflector.getAllAndOverride<boolean>(HTTP_CACHE_SKIP, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return next.handle();
    }

    if (!SAFE_METHODS.has(requestMethod)) {
      // Non-safe, non-mutation methods (e.g. OPTIONS) are passed through.
      return next.handle();
    }

    const options =
      this.reflector.getAllAndOverride<HttpCacheOptions>(HTTP_CACHE_METADATA, [
        context.getHandler(),
        context.getClass(),
      ]) ?? {};

    response.setHeader('Cache-Control', this.buildCacheControl(options));
    response.setHeader('Vary', 'Authorization, Accept-Encoding');

    return next.handle().pipe(
      // If the controller throws, our pre-set `private, must-revalidate`
      // header would otherwise leak out attached to a 4xx / 5xx body —
      // a real risk because transient 5xx responses would then be
      // cached and replayed by intermediaries. Override before re-throw.
      catchError((err: unknown) => {
        this.markNonCacheable(response);
        return throwError(() => err);
      }),
      map((data) => this.applyGetHeaders(request, response, data)),
    );
  }

  private shouldAlwaysSkip(request: Request): boolean {
    // `originalUrl` is the unmodified URL (preserved by Express across
    // nested routers); `url` is what the router rewrote it to; `path`
    // is router-stripped. Use `originalUrl ?? url` because that always
    // matches what the client actually requested, including paths
    // mounted under nested routers whose `baseUrl` + `path` would
    // otherwise need re-stitching.
    const path = request.originalUrl ?? request.url ?? '';
    if (!path) return false;
    for (const prefix of SKIP_PATH_PREFIXES) {
      if (path === prefix || path.startsWith(`${prefix}/`)) {
        return true;
      }
    }
    return false;
  }

  private applyGetHeaders(
    request: Request,
    response: Response,
    data: unknown,
  ): unknown {
    if (!this.isCacheableBody(data, response)) {
      this.setDebugHeader(response, 'bypass');
      return data;
    }

    // Don't bother hashing huge payloads; ETag is a "free" win only on
    // small responses that we expect to be re-served often.
    const serialized = canonicalStringify(data);
    if (
      serialized.length === 0 ||
      serialized.length > this.maxPayloadBytes
    ) {
      if (serialized.length > this.maxPayloadBytes) {
        this.logger.warn(
          `Skipping ETag hash for ${request.method} ${
            request.originalUrl ?? request.url
          }; canonical payload ${serialized.length} bytes exceeds limit of ` +
            `${this.maxPayloadBytes}. Annotate the handler with ` +
            '`@SkipHttpCache()` or `@HttpCacheTtl()` to opt out.',
        );
      }
      this.setDebugHeader(response, 'bypass');
      return data;
    }

    const etagHash = createHash('sha256').update(serialized).digest('hex');
    const etag = `"${etagHash}"`;

    response.setHeader('ETag', etag);

    if (this.ifNoneMatchMatches(request, etag)) {
      // Short-circuit 304 responses: no body, no Content-Length, no
      // Content-Type. Returning undefined tells NestJS to emit an empty
      // body while keeping the ETag / Cache-Control headers above —
      // which satisfies RFC 7232 §4.1.
      response.removeHeader('Content-Length');
      response.removeHeader('Content-Type');
      response.status(304);
      this.setDebugHeader(response, 'hit');

      this.logger.debug(
        `304 Not Modified for ${request.method} ${request.originalUrl ?? request.url}`,
      );
      return undefined;
    }

    this.setDebugHeader(response, 'miss');
    return data;
  }

  private markNonCacheable(response: Response): void {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    // Strip Vary too: an error response that's already no-store
    // shouldn't carry a Vary header, since intermediaries then partition
    // a cache by Authorization on responses that never get cached.
    response.removeHeader('ETag');
    response.removeHeader('Vary');
  }

  private buildCacheControl(options: HttpCacheOptions): string {
    const ttl = options.ttl !== undefined ? options.ttl : this.defaultTtl;
    const visibility = options.public === true ? 'public' : 'private';

    const directives: string[] = [visibility];

    // ttl === 0 is intentional: the maintainer contract is that 0 means
    // "store but force revalidation", which RFC 7234 spells as
    // `no-cache`. `max-age=0` would ALSO expire immediately but is a
    // different signal in caching folklore; we prefer the unambiguous one.
    if (typeof ttl === 'number' && Number.isFinite(ttl)) {
      if (ttl <= 0) {
        directives.push('no-cache');
      } else {
        directives.push(`max-age=${Math.floor(ttl)}`);
      }
    }

    if (visibility === 'private') {
      directives.push('must-revalidate');
    }

    return directives.join(', ');
  }

  private isCacheableBody(data: unknown, response: Response): boolean {
    if (data === null || data === undefined) {
      return true;
    }

    if (typeof data !== 'object') {
      return true;
    }

    // Node Readables expose `.pipe`; Web streams expose `.pipeTo`.
    const candidate = data as { pipe?: unknown; pipeTo?: unknown };
    if (typeof candidate.pipe === 'function' || typeof candidate.pipeTo === 'function') {
      return false;
    }

    // Web Readables expose an async iterator (ReadableStream / Readable.fromWeb).
    if (typeof (data as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function') {
      return false;
    }

    // Buffers and NestJS StreamableFile wrappers are pass-through.
    if (Buffer.isBuffer(data)) {
      return false;
    }

    // Bare typed-array / ArrayBufferView returns would otherwise be
    // canonicalized as numeric-keyed objects, producing a misleading
    // ETag on byte-equal downloads. Skip them.
    if (
      typeof ArrayBuffer !== 'undefined' &&
      typeof ArrayBuffer.isView === 'function' &&
      ArrayBuffer.isView(data)
    ) {
      return false;
    }

    // Honor a controller-set Content-Type: handlers that decorate
    // themselves with `@Header('Content-Type', '...')` to emit a non-JSON
    // MIME are signalling that they intend to opt out of ETag hashing
    // for their (binary / streamed) body. This keeps the existing
    // `private, must-revalidate` header in place but skips ETag.
    const contentType = response.getHeader?.('Content-Type');
    if (typeof contentType === 'string' && !contentType.includes('json')) {
      return false;
    }

    return true;
  }

  private ifNoneMatchMatches(
    request: Request,
    etag: string,
  ): boolean {
    const raw = request.headers['if-none-match'];
    if (raw === undefined) return false;
    const values = normalizeIfNoneMatch(raw);

    // Wildcard: matches as long as a representation exists.
    if (values.includes('*')) return true;
    // Strip optional W/ weak prefix and surrounding whitespace, then
    // compare opaque-tag portion (RFC 7232 §2.3.2 weak comparison).
    const target = stripWeakPrefix(etag);

    return values.some(value => stripWeakPrefix(value) === target);
  }

  private setDebugHeader(response: Response, value: string): void {
    if (this.debugHeaders) {
      response.setHeader('X-Http-Cache', value);
    }
  }
}

/**
 * Parse an `If-None-Match` header value into its constituent tag list,
 * handling the (rare) case where Express flattens multiple headers
 * into an array.
 */
function normalizeIfNoneMatch(raw: string | string[]): string[] {
  const values = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const v of values) {
    for (const piece of v.split(',')) {
      const trimmed = piece.trim();
      if (trimmed.length > 0) out.push(trimmed);
    }
  }
  return out;
}

/**
 * Strip the optional weak comparison prefix `W/` from an ETag value.
 * Per RFC 7232 we always run weak comparison for `If-None-Match`
 * semantics; the opaque-tag substring is what matters.
 */
function stripWeakPrefix(value: string): string {
  return value.startsWith('W/') ? value.slice(2) : value;
}

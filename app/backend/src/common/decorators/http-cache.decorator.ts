import { SetMetadata } from '@nestjs/common';

/**
 * HTTP cache metadata.
 *
 * Controllers and route handlers can opt in or out of caching and tweak
 * the Cache-Control directives emitted by `HttpCacheInterceptor`.
 */
export interface HttpCacheOptions {
  /**
   * When true, the response is allowed to be cached by shared caches.
   * Use sparingly: only for endpoints that do not depend on the
   * authenticated principal (Authorization). Defaults to `false`
   * ("private, must-revalidate") which is safe for NGO-scoped data.
   */
  public?: boolean;

  /**
   * Optional explicit TTL in seconds. When set, expands the directive
   * with `max-age=<ttl>`. A value of `0` downgrades to
   * `no-cache` (effective revalidation via ETag) while keeping the
   * `ETag` header.
   */
  ttl?: number;
}

export const HTTP_CACHE_METADATA = 'http_cache:options';
export const HTTP_CACHE_SKIP = 'http_cache:skip';

/**
 * Skip HTTP caching entirely for the decorated handler or controller.
 * Use for endpoints that:
 *  - return sensitive or per-user content that must never be cached,
 *  - already set their own cache headers,
 *  - stream binary content (e.g., file downloads).
 *
 * @example
 *   @Get('secret')
 *   @SkipHttpCache()
 *   getSecret() { ... }
 */
export const SkipHttpCache = (): MethodDecorator & ClassDecorator =>
  SetMetadata(HTTP_CACHE_SKIP, true);

/**
 * Override the default Cache-Control TTL (max-age) for the decorated
 * handler. The default visibility (`private`) is preserved unless
 * paired with `@HttpCache({ public: true })`.
 *
 * @example
 *   @Get('campaigns')
 *   @HttpCacheTtl(60)
 *   list() { ... } // → Cache-Control: private, max-age=60, must-revalidate
 */
export const HttpCacheTtl = (ttl: number): MethodDecorator & ClassDecorator =>
  SetMetadata(HTTP_CACHE_METADATA, { ttl });

/**
 * Configure HTTP cache directives explicitly for the decorated handler.
 *
 * - `public: true` switches the directive to `public` so CDN / shared
 *   caches may store the response. Only use for endpoints where the
 *   payload is identical for every principal.
 * - `ttl` sets `max-age=<ttl>`; omit it to delegate to the global
 *   default (currently `must-revalidate` / no `max-age`).
 *
 * @example
 *   @Get('public/stats')
 *   @Public()
 *   @HttpCache({ public: true, ttl: 300 })
 *   stats() { ... } // → Cache-Control: public, max-age=300
 */
export const HttpCache = (
  options: HttpCacheOptions,
): MethodDecorator & ClassDecorator =>
  SetMetadata(HTTP_CACHE_METADATA, { ...options });

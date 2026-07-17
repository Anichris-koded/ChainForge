import { Logger, Module } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import helmet, { HelmetOptions } from 'helmet';
import { RedisService } from '@liaoliaots/nestjs-redis';


const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
];
const DEFAULT_RATE_LIMIT = 100;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_CORS_METHODS = [
  'GET',
  'HEAD',
  'PUT',
  'PATCH',
  'POST',
  'DELETE',
  'OPTIONS',
];

const RATE_LIMIT_EXEMPT_PATHS = [
  /^\/(api\/)?(v\d+\/)?health(\/|$)/i,
  /^\/(api\/)?(v\d+\/)?metrics(\/|$)/i,
  /^\/(api\/)?docs(\/|$)/i,
];

const parseBoolean = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined) {
    return fallback;
  }

  return value.trim().toLowerCase() === 'true';
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const normalizeOrigin = (origin: string): string => origin.replace(/\/$/, '');

const parseAllowedOrigins = (value: string | undefined): string[] => {
  if (value === undefined) {
    return [];
  }

  const parsed = value
    .split(',')
    .map(origin => normalizeOrigin(origin.trim()))
    .filter(origin => origin.length > 0 && origin !== '*');

  return Array.from(new Set(parsed));
};

const isRateLimitExempt = (req: Request): boolean => {
  const path = req.path ?? req.originalUrl ?? req.url ?? '';
  const normalizedPath = path.split('?')[0];
  return RATE_LIMIT_EXEMPT_PATHS.some(pattern => pattern.test(normalizedPath));
};

// Explicit Helmet configuration: recommended security headers for production
const buildHelmetOptions = (config: ConfigService): HelmetOptions => {
  const nodeEnv = config.get<string>('NODE_ENV', 'development');
  const isProduction = nodeEnv === 'production';

  return {
    contentSecurityPolicy: isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: isProduction ? { policy: 'same-origin' } : false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    originAgentCluster: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: isProduction
      ? {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true,
        }
      : false,
    xContentTypeOptions: true,
    xDnsPrefetchControl: { allow: false },
    xDownloadOptions: false,
    xFrameOptions: { action: 'deny' },
    xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
    xPoweredBy: false,
    xXssProtection: false,
  };
};

export const createHelmetMiddleware = (config: ConfigService) =>
  helmet(buildHelmetOptions(config));

const resolveAllowedOrigins = (config: ConfigService): string[] => {
  const rawOrigins = config.get<string>('CORS_ORIGINS');
  const nodeEnv = config.get<string>('NODE_ENV');
  if (rawOrigins === undefined) {
    if (nodeEnv === 'development' || nodeEnv === 'test') {
      return DEFAULT_ALLOWED_ORIGINS;
    }

    return [];
  }

  return parseAllowedOrigins(rawOrigins);
};

export const buildCorsOptions = (config: ConfigService): CorsOptions => {
  const allowedOrigins = resolveAllowedOrigins(config);
  const allowCredentials = parseBoolean(
    config.get<string>('CORS_ALLOW_CREDENTIALS'),
    false,
  );

  return {
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, false);
      }

      const normalizedOrigin = normalizeOrigin(origin);
      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }

      return callback(null, false);
    },
    methods: DEFAULT_CORS_METHODS.join(','),
    credentials: allowCredentials,
    optionsSuccessStatus: 204,
  };
};

export const createCorsOriginValidator = (
  config: ConfigService,
): RequestHandler => {
  const allowedOrigins = resolveAllowedOrigins(config);

  return (req: Request, res: Response, next: NextFunction) => {
    const originHeader = req.headers.origin as string | string[] | undefined;
    const originRaw: string | undefined = Array.isArray(originHeader)
      ? originHeader[0]
      : originHeader;
    const origin: string | undefined =
      typeof originRaw === 'string' ? originRaw : undefined;
    if (!origin) {
      next();
      return;
    }

    const normalizedOrigin = normalizeOrigin(origin);
    if (!allowedOrigins.includes(normalizedOrigin)) {
      res.status(403).send('Not allowed by CORS');
      return;
    }

    next();
  };
};

export const createRateLimiter = (
  config: ConfigService,
  redisService?: RedisService,
): RequestHandler => {
  const logger = new Logger('RateLimiter');

  const windowMs = parseNumber(
    config.get<string>('RATE_LIMIT_WINDOW_MS') ?? config.get<string>('THROTTLE_TTL'),
    DEFAULT_RATE_LIMIT_WINDOW_MS,
  );
  const limit = parseNumber(
    config.get<string>('RATE_LIMIT_LIMIT') ?? config.get<string>('API_RATE_LIMIT'),
    DEFAULT_RATE_LIMIT,
  );

  const windowSeconds = Math.max(Math.ceil(windowMs / 1000), 1);

  return async (req: Request, res: Response, next: NextFunction) => {
    if (isRateLimitExempt(req)) {
      next();
      return;
    }

    // Apply rate limiting for verification endpoints always,
    // otherwise only apply to unauthenticated requests (no Authorization header)
    const path = req.path ?? req.originalUrl ?? req.url ?? '';
    const normalizedPath = path.split('?')[0];
    const isVerificationPath = /^\/(api\/)?(v\d+\/)?verification(\/|$)/i.test(
      normalizedPath,
    );

    const hasAuthHeader = !!(
      (req.headers &&
        (req.headers.authorization || req.headers.Authorization)) ||
      req.user
    );

    if (!isVerificationPath && hasAuthHeader) {
      // Authenticated non-verification requests are not rate-limited here
      next();
      return;
    }

    const forwardedIp =
      Array.isArray(req.ips) && req.ips.length > 0 ? req.ips[0] : undefined;
    const key = `ratelimit:global:${
      (typeof forwardedIp === 'string' ? forwardedIp : undefined) ??
      (typeof req.ip === 'string' ? req.ip : undefined) ??
      'unknown'
    }`;

    const now = Date.now();
    const minTimestamp = now - windowMs;
    const uniqueMember = `${now}:${Math.random().toString(36).substring(2, 15)}`;

    try {
      if (!redisService) {
        throw new Error('RedisService is not configured/available');
      }

      const client = redisService.getOrThrow();

      // Execute MULTI pipeline to keep header reads consistent
      const multi = client.multi();
      multi.zremrangebyscore(key, '-inf', minTimestamp);
      multi.zadd(key, now, uniqueMember);
      multi.zrange(key, 0, 0, 'WITHSCORES');
      multi.zcard(key);
      multi.expire(key, windowSeconds);

      const results = await multi.exec();
      if (!results) {
        throw new Error('Redis multi transaction execution returned null');
      }

      const zrangeResult = results[2];
      const zcardResult = results[3];

      const zrangeRes = Array.isArray(zrangeResult) ? (zrangeResult[1] as string[]) : undefined;
      const zcardRes = Array.isArray(zcardResult) ? (zcardResult[1] as number) : undefined;

      const count = typeof zcardRes === 'number' ? zcardRes : 1;

      // ZRANGE WITHSCORES returns: [member1, score1, member2, score2, ...]
      // The oldest timestamp is the score of the first entry, i.e., index 1
      let oldestTimestamp = now;
      if (zrangeRes && zrangeRes.length >= 2) {
        const parsed = Number(zrangeRes[1]);
        if (!isNaN(parsed)) {
          oldestTimestamp = parsed;
        }
      }

      const remaining = Math.max(limit - count, 0);
      const resetSeconds = Math.max(
        Math.ceil((oldestTimestamp + windowMs - now) / 1000),
        0,
      );

      res.setHeader('RateLimit-Limit', limit.toString());
      res.setHeader('RateLimit-Remaining', remaining.toString());
      res.setHeader('RateLimit-Reset', resetSeconds.toString());

      if (count > limit) {
        res.setHeader('Retry-After', resetSeconds.toString());
        res.status(429).send('Too many requests, please try again later.');
        return;
      }
    } catch (err) {
      logger.warn(
        `Redis rate limiter failed, failing open: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    next();
  };
};
/**
 * CSRF Protection Posture:
 * CSRF is currently mitigated by design due to our stateless, token-based authentication
 * mechanism (`x-api-key` header). Since browsers do not automatically attach custom headers
 * on cross-origin requests, CSRF attacks are inherently prevented.
 * 
 * WARNING:
 * If cookie-based session management or any browser-managed credentials are introduced 
 * in the future, CSRF protection middleware MUST be implemented.
 */
@Module({})
export class SecurityModule {}

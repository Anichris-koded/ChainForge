/**
 * Error-envelope e2e tests.
 *
 * CONVENTION: every test must assert its status with a literal number,
 * e.g. `.expect(503)` — never a variable. The coverage matrix in
 * `test/error-envelope-coverage.spec.ts` statically scans this file for
 * `.expect(NNN)` literals to verify that every 4xx/5xx status documented
 * in the OpenAPI spec has an envelope test here.
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { RequestIdInterceptor } from '../src/common/interceptors/request-id.interceptor';

describe('Error Handling (e2e)', () => {
  let app: INestApplication;

  // ApiKeyGuard is global; use its env-var fallback so requests reach the
  // test-error controller instead of short-circuiting with 401.
  const API_KEY = process.env.API_KEY || 'test-api-key-error-handling';

  beforeEach(async () => {
    process.env.API_KEY = API_KEY;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Mirror production setup
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
      prefix: 'v',
    });
    app.useGlobalInterceptors(new RequestIdInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const expectErrorEnvelope = (body: any) => {
    expect(body).toHaveProperty('code');
    expect(body).toHaveProperty('message');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('path');
    expect(typeof body.code).toBe('number');
    expect(typeof body.message).toBe('string');
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.path).toBe('string');
  };

  it('/test-error/generic (GET) - should return standardized error response', () => {
    return request(app.getHttpServer())
      .get('/api/v1/test-error/generic')
      .set('x-api-key', API_KEY)
      .expect(500)
      .then(response => {
        expectErrorEnvelope(response.body);
        expect(response.body).toEqual({
          code: 500,
          message: 'This is a generic error',
          details: expect.objectContaining({
            error_type: 'Error',
          }),
          traceId: expect.any(String),
          timestamp: expect.any(String),
          path: '/api/v1/test-error/generic',
        });
      });
  });

  it('/test-error/bad-request (GET) - should return standardized error response', () => {
    return request(app.getHttpServer())
      .get('/api/v1/test-error/bad-request')
      .set('x-api-key', API_KEY)
      .expect(400)
      .then(response => {
        expectErrorEnvelope(response.body);
        expect(response.body).toEqual({
          code: 400,
          message: 'This is a bad request error',
          details: expect.any(Object),
          traceId: expect.any(String),
          timestamp: expect.any(String),
          path: '/api/v1/test-error/bad-request',
        });
      });
  });

  it('/test-error/internal-server-error (GET) - should return standardized error response', () => {
    return request(app.getHttpServer())
      .get('/api/v1/test-error/internal-server-error')
      .set('x-api-key', API_KEY)
      .expect(500)
      .then(response => {
        expectErrorEnvelope(response.body);
        expect(response.body).toEqual({
          code: 500,
          message: 'This is an internal server error',
          details: expect.any(Object),
          traceId: expect.any(String),
          timestamp: expect.any(String),
          path: '/api/v1/test-error/internal-server-error',
        });
      });
  });

  it('/test-error/unauthorized (GET) - should return 401 with standardized envelope', () => {
    return request(app.getHttpServer())
      .get('/api/v1/test-error/unauthorized')
      .set('x-api-key', API_KEY)
      .expect(401)
      .then(response => {
        expectErrorEnvelope(response.body);
        expect(response.body.code).toBe(401);
        expect(response.body.message).toBe('Authentication required');
        expect(response.body).toHaveProperty('traceId');
      });
  });

  it('/test-error/forbidden (GET) - should return 403 with standardized envelope', () => {
    return request(app.getHttpServer())
      .get('/api/v1/test-error/forbidden')
      .set('x-api-key', API_KEY)
      .expect(403)
      .then(response => {
        expectErrorEnvelope(response.body);
        expect(response.body.code).toBe(403);
        expect(response.body.message).toBe('Access denied');
        expect(response.body).toHaveProperty('traceId');
      });
  });

  it('/test-error/not-found (GET) - should return 404 with standardized envelope', () => {
    return request(app.getHttpServer())
      .get('/api/v1/test-error/not-found')
      .set('x-api-key', API_KEY)
      .expect(404)
      .then(response => {
        expectErrorEnvelope(response.body);
        expect(response.body.code).toBe(404);
        expect(response.body.message).toBe('Resource not found');
        expect(response.body).toHaveProperty('traceId');
      });
  });

  it('/test-error/service-unavailable (GET) - should return 503 with standardized envelope', () => {
    return request(app.getHttpServer())
      .get('/api/v1/test-error/service-unavailable')
      .set('x-api-key', API_KEY)
      .expect(503)
      .then(response => {
        expectErrorEnvelope(response.body);
        expect(response.body.code).toBe(503);
        expect(response.body.message).toBe('Service temporarily unavailable');
        expect(response.body).toHaveProperty('traceId');
      });
  });

  it('/test-error/validation-error (POST) - should return standardized validation error response', () => {
    return request(app.getHttpServer())
      .post('/api/v1/test-error/validation-error')
      .set('x-api-key', API_KEY)
      .send({ invalidField: 'invalid' })
      .expect(400)
      .then(response => {
        expectErrorEnvelope(response.body);
        expect(response.body.code).toBe(400);
        expect(response.body).toHaveProperty('traceId');
      });
  });

  it('/test-error/prisma-error-simulation (GET) - should return standardized Prisma error response', () => {
    return request(app.getHttpServer())
      .get('/api/v1/test-error/prisma-error-simulation')
      .set('x-api-key', API_KEY)
      .expect(409)
      .then(response => {
        expectErrorEnvelope(response.body);
        expect(response.body).toEqual({
          code: 409,
          message: 'Unique constraint violation',
          details: expect.objectContaining({
            target: ['email'],
            field: 'email',
          }),
          traceId: expect.any(String),
          timestamp: expect.any(String),
          path: '/api/v1/test-error/prisma-error-simulation',
        });
      });
  });

  it('should include X-Request-ID header in response', () => {
    return request(app.getHttpServer())
      .get('/api/v1/test-error/bad-request')
      .set('x-api-key', API_KEY)
      .expect(400)
      .then(response => {
        expect(response.headers).toHaveProperty('x-request-id');
        expect(response.headers['x-request-id']).toMatch(/^[A-Z0-9]+$/);
      });
  });

  it('should use provided X-Request-ID header as traceId', () => {
    const customTraceId = 'MY-CUSTOM-TRACE-ID';
    return request(app.getHttpServer())
      .get('/api/v1/test-error/bad-request')
      .set('x-api-key', API_KEY)
      .set('X-Request-ID', customTraceId)
      .expect(400)
      .then(response => {
        expect(response.body.traceId).toBe(customTraceId);
        expect(response.headers['x-request-id']).toBe(customTraceId);
      });
  });
});

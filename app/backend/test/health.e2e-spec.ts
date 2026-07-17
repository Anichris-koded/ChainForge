import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { HealthController } from './../src/health/health.controller';
import { HealthService } from './../src/health/health.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { LoggerService } from './../src/logger/logger.service';
import { ONCHAIN_ADAPTER_TOKEN } from './../src/onchain/onchain.adapter';

describe('Health dependencies (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController], // the horn
      providers: [
        HealthService, // the wiring behind it (real logic runs)
        // Fake on-chain adapter: instant, no real network call.
        {
          provide: ONCHAIN_ADAPTER_TOKEN,
          useValue: {
            getContractMetadata: () =>
              Promise.resolve({
                version: '1.0.0',
                name: 'AidEscrow',
                timestamp: new Date(),
              }),
          },
        },
        // Empty stubs for deps our method doesn't use, but the
        // service still asks for at construction time.
        { provide: ConfigService, useValue: { get: () => undefined } },
        {
          provide: LoggerService,
          useValue: { log: () => {}, warn: () => {}, error: () => {} },
        },
        { provide: PrismaService, useValue: {} },
        { provide: RedisService, useValue: {} },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/health/dependencies (GET) reports onchain_rpc_ms', () => {
    return request(app.getHttpServer())
      .get('/health/dependencies')
      .expect(200)
      .expect(
        (res: {
          body: {
            status: string;
            checks: { onchain: string; onchain_rpc_ms: number };
          };
        }) => {
          expect(res.body.status).toBe('ok');
          expect(res.body.checks.onchain).toBe('up');
          expect(typeof res.body.checks.onchain_rpc_ms).toBe('number');
        },
      );
  });
});

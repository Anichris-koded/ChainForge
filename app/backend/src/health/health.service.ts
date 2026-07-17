import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { PrismaService } from '../prisma/prisma.service';
import { LoggerService } from '../logger/logger.service';
import {
  OnchainAdapter,
  ONCHAIN_ADAPTER_TOKEN,
} from '../onchain/onchain.adapter';

type CheckStatus = 'up' | 'down' | 'skipped';

interface HealthCheckResult {
  status: CheckStatus;
  details?: Record<string, unknown>;
}

export interface LivenessResponse {
  status: 'ok';
  service: 'backend';
  version: string;
  environment: string;
  timestamp: string;
  checks: {
    process: HealthCheckResult;
  };
}

export interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  ready: boolean;
  service: 'backend';
  timestamp: string;
  checks: {
    database: HealthCheckResult;
    stellarRpc: HealthCheckResult;
    redis: HealthCheckResult;
  };
}

export interface DependenciesResponse {
  status: 'ok' | 'degraded' | 'down'; // degraded = alive but slow
  service: 'backend';
  timestamp: string;
  checks: {
    onchain_rpc_ms: number; // the number the issue asks for
    onchain: 'up' | 'down';
  };
}

@Injectable()
export class HealthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly prisma: PrismaService,
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter,
    private readonly redisService: RedisService,
  ) {}

  check() {
    const version = process.env.npm_package_version ?? '0.0.0';

    return {
      status: 'ok',
      service: 'backend',
      version,
      environment: this.configService.get<string>('NODE_ENV') ?? 'development',
      timestamp: new Date().toISOString(),
    };
  }

  getLiveness(): LivenessResponse {
    const uptimeSeconds = Math.floor(process.uptime());
    const memory = process.memoryUsage();

    return {
      status: 'ok',
      service: 'backend',
      version: process.env.npm_package_version ?? '0.0.0',
      environment: this.configService.get<string>('NODE_ENV') ?? 'development',
      timestamp: new Date().toISOString(),
      checks: {
        process: {
          status: 'up',
          details: {
            pid: process.pid,
            uptimeSeconds,
            nodeVersion: process.version,
            rssBytes: memory.rss,
            heapUsedBytes: memory.heapUsed,
          },
        },
      },
    };
  }

  async getReadiness(): Promise<ReadinessResponse> {
    const [database, stellarRpc, redis] = await Promise.all([
      this.checkDatabase(),
      this.checkStellarRpc(),
      this.checkRedis(),
    ]);

    const stellarRequired = this.isEnabled(
      this.configService.get<string>('HEALTHCHECK_STELLAR_REQUIRED'),
    );

    const dependenciesReady =
      database.status === 'up' &&
      (!stellarRequired || stellarRpc.status === 'up');

    return {
      status: dependenciesReady ? 'ready' : 'not_ready',
      ready: dependenciesReady,
      service: 'backend',
      timestamp: new Date().toISOString(),
      checks: {
        database,
        stellarRpc,
        redis,
      },
    };
  }

  async getDependenciesHealth(): Promise<DependenciesResponse> {
    const ONCHAIN_THRESHOLD_MS = 5000; // 5s = the "too slow" line from the issue

    const startTime = Date.now(); // stopwatch START
    let onchainStatus: 'up' | 'down' = 'up';

    try {
      // The one RPC call we time. Swap to getAdmin() if the maintainer asks.
      await this.onchainAdapter.getContractMetadata();
    } catch (error) {
      onchainStatus = 'down';
      const message =
        error instanceof Error ? error.message : 'Unknown on-chain error';
      this.logger.warn('Dependencies on-chain check failed', 'HealthService', {
        error: message,
      });
    }

    const onchainRpcMs = Date.now() - startTime; // stopwatch STOP → elapsed ms

    // Decide overall status: dead > slow > healthy
    let status: 'ok' | 'degraded' | 'down' = 'ok';
    if (onchainStatus === 'down') {
      status = 'down';
    } else if (onchainRpcMs > ONCHAIN_THRESHOLD_MS) {
      status = 'degraded';
    }

    return {
      status,
      service: 'backend',
      timestamp: new Date().toISOString(),
      checks: {
        onchain_rpc_ms: onchainRpcMs,
        onchain: onchainStatus,
      },
    };
  }
  logHealthCheck(requestId?: string) {
    this.logger.log('Health check endpoint accessed', 'HealthService', {
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  logErrorAttempt(requestId?: string) {
    this.logger.warn('Error endpoint triggered for testing', 'HealthService', {
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  private async checkRedis(): Promise<HealthCheckResult> {
    try {
      const client = this.redisService.getOrThrow();
      await client.ping();
      return { status: 'up', details: { connected: true } };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown Redis error';
      this.logger.warn('Redis health check failed', 'HealthService', {
        error: message,
      });
      return { status: 'down', details: { connected: false, error: message } };
    }
  }

  private async checkDatabase(): Promise<HealthCheckResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'up',
        details: {
          connected: true,
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown database error';

      this.logger.error(
        'Database readiness check failed',
        undefined,
        'HealthService',
        {
          error: message,
        },
      );

      return {
        status: 'down',
        details: {
          connected: false,
          error: message,
        },
      };
    }
  }

  private async checkStellarRpc(): Promise<HealthCheckResult> {
    const rpcUrl = this.configService.get<string>('STELLAR_RPC_URL');

    if (!rpcUrl) {
      return {
        status: 'skipped',
        details: {
          reason: 'STELLAR_RPC_URL not configured',
        },
      };
    }

    const timeoutMs = Number(
      this.configService.get<string>('HEALTHCHECK_STELLAR_TIMEOUT_MS') ??
        '3000',
    );

    try {
      const response = await fetch(rpcUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(
          Number.isFinite(timeoutMs) ? timeoutMs : 3000,
        ),
      });

      if (!response.ok) {
        return {
          status: 'down',
          details: {
            connected: false,
            statusCode: response.status,
          },
        };
      }

      return {
        status: 'up',
        details: {
          connected: true,
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown Stellar RPC error';

      this.logger.warn('Stellar RPC readiness check failed', 'HealthService', {
        error: message,
        rpcUrl,
      });

      return {
        status: 'down',
        details: {
          connected: false,
          error: message,
        },
      };
    }
  }

  private isEnabled(value?: string): boolean {
    if (!value) {
      return false;
    }

    return value.trim().toLowerCase() === 'true';
  }

  async checkOnchainContract(): Promise<{
    status: 'up' | 'down';
    latencyMs: number;
    metadata?: { version: string; name: string };
    error?: string;
  }> {
    const startTime = Date.now();
    try {
      const contractMetadata = await this.onchainAdapter.getContractMetadata();
      const latency = Date.now() - startTime;
      return {
        status: 'up',
        latencyMs: latency,
        metadata: {
          version: contractMetadata.version,
          name: contractMetadata.name,
        },
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        'On-chain contract health check failed',
        undefined,
        'HealthService',
        { error: errorMsg },
      );
      return {
        status: 'down',
        latencyMs: latency,
        error: errorMsg,
      };
    }
  }
}

import {
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';

/**
 * Custom Prometheus metric providers
 */
export const metricsProviders = [
  // HTTP Metrics
  makeCounterProvider({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
  }),
  // Tail-latency SLO buckets (issue #243).
  // Spans 25 ms → 10 000 ms so operators can alert on p99 per route.
  // PromQL to query p99 per route:
  //   histogram_quantile(0.99,
  //     sum by (le, route, method)(
  //       rate(http_request_duration_seconds_bucket[5m])
  //     )
  //   )
  makeHistogramProvider({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds, with SLO-tuned buckets for p99 alerting',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
  }),

  // Job Metrics
  makeCounterProvider({
    name: 'jobs_processed_total',
    help: 'Total number of jobs processed successfully',
    labelNames: ['job_type'],
  }),
  makeCounterProvider({
    name: 'jobs_failed_total',
    help: 'Total number of jobs that failed',
    labelNames: ['job_type'],
  }),

  // Connection Metrics
  makeGaugeProvider({
    name: 'active_connections',
    help: 'Number of active connections',
    labelNames: [],
  }),

  // Database Metrics
  makeHistogramProvider({
    name: 'db_query_duration_seconds',
    help: 'Duration of database queries in seconds',
    labelNames: ['operation'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  }),

  // On-chain Metrics
  makeCounterProvider({
    name: 'onchain_operations_total',
    help: 'Total number of on-chain operations',
    labelNames: ['operation', 'adapter', 'status'],
  }),
  makeHistogramProvider({
    name: 'onchain_operation_duration_seconds',
    help: 'Duration of on-chain operations in seconds',
    labelNames: ['operation', 'adapter'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  }),
  makeHistogramProvider({
    name: 'contract_call_latency_seconds',
    help: 'Latency of Testnet contract calls grouped by operation and status',
    labelNames: ['operation', 'status'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
  }),
  makeCounterProvider({
    name: 'tx_submission_failures_total',
    help: 'Total number of Testnet transaction submission failures',
    labelNames: ['operation', 'reason'],
  }),

  // Ingestion Metrics
  makeGaugeProvider({
    name: 'ingestion_lag_seconds',
    help: 'Time lag between event creation and processing in seconds',
    labelNames: ['source'],
  }),

  // Webhook Metrics
  makeCounterProvider({
    name: 'webhook_retries_total',
    help: 'Total number of webhook delivery retries',
    labelNames: ['webhook_type', 'reason'],
  }),
  makeHistogramProvider({
    name: 'webhook_delivery_duration_seconds',
    help: 'Duration of webhook delivery attempts in seconds',
    labelNames: ['webhook_type'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  }),
  makeCounterProvider({
    name: 'callback_failures_total',
    help: 'Total number of callback or async processing failures',
    labelNames: ['callback_type', 'reason'],
  }),

  // Error Rate Metrics
  makeCounterProvider({
    name: 'error_rate_total',
    help: 'Total number of errors across all systems',
    labelNames: [
      'method',
      'route',
      'status_code',
      'job_type',
      'operation',
      'adapter',
      'error_type',
    ],
  }),

  // Email Metrics
  makeCounterProvider({
    name: 'email_delivery_total',
    help: 'Total number of email delivery attempts',
    labelNames: ['status'],
  }),
  makeHistogramProvider({
    name: 'email_delivery_duration_seconds',
    help: 'Duration of email delivery attempts in seconds',
    labelNames: ['status'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  }),

  // Analytics Cache Metrics
  makeCounterProvider({
    name: 'analytics_cache_hits_total',
    help: 'Total number of analytics cache hits',
    labelNames: ['endpoint'],
  }),
  makeCounterProvider({
    name: 'analytics_cache_misses_total',
    help: 'Total number of analytics cache misses',
    labelNames: ['endpoint'],
  }),
  makeCounterProvider({
    name: 'analytics_cache_invalidations_total',
    help: 'Total number of analytics cache invalidations',
    labelNames: ['reason'],
  }),
];

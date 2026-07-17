# ChainForge Backend

NestJS API server powering aid orchestration, verification workflows, on-chain anchoring, and operational tooling for the ChainForge platform.

---

## Architecture

The backend provides:

- **Aid logic and APIs** — Package management, claims processing, disbursement workflows
- **Verification APIs** — Inbox management with approve, reject, and resubmission flows
- **On-chain anchoring** — Soroban smart contract integration via Stellar RPC
- **Queue processing** — BullMQ-backed background jobs for async workflows
- **Observability** — Prometheus metrics, structured logging, Sentry error tracking

### Stack

| Layer | Technology |
|---|---|
| Framework | NestJS (TypeScript) |
| Database | PostgreSQL via Prisma ORM |
| Queue | BullMQ (Redis-backed) |
| Cache | Redis |
| Auth | JWT + API keys |
| Monitoring | Prometheus, Sentry |

---

## Local development

```bash
# From the monorepo root
pnpm install
pnpm --filter backend run start:dev
```

By default the server listens on the port specified in your `.env` file (see `.env.example`).

### Environment setup

```bash
cp app/backend/.env.example app/backend/.env
```

Edit `.env` with your specific values. See [.env.example](.env.example) for detailed inline comments and local development defaults.

#### Configuration modes

**Local development:** The default `.env.example` values work out of the box:
- Uses local PostgreSQL with default credentials
- Points to Stellar testnet
- Client-side verification (no OpenAI key needed)
- Queues disabled (no Redis needed)
- Full logging and Swagger enabled

**Production:** Update these critical variables:
- `NODE_ENV=production`
- `DATABASE_URL` — Use secure credentials and connection pooling
- `STELLAR_RPC_URL` — Switch to mainnet if deploying live
- `JWT_SECRET` — Generate with `openssl rand -base64 32`
- `CORS_ORIGINS` — Set to your actual frontend domain(s)
- `METRICS_ENABLED=true` — Enable for monitoring
- `SWAGGER_ENABLED=false` — Disable public API docs
- `LOG_LEVEL=info` — Reduce log verbosity

### Database (Prisma)

```bash
pnpm --filter backend prisma:generate
pnpm --filter backend prisma:migrate
```

### Health check

```bash
curl -s http://localhost:3001/health
```

### Scripts

```bash
pnpm --filter backend lint
pnpm --filter backend test
pnpm --filter backend run test:e2e
```

---

## Environment variables

All environment variables are documented in [`.env.example`](.env.example) with inline comments, examples, and notes on when each is required.

| Variable | Description | Default |
|---|---|---|
| **Server configuration** |
| `PORT` | Port the NestJS server listens on | `3001` |
| `NODE_ENV` | Node environment | `development` |
| **Database** |
| `DATABASE_URL` | PostgreSQL connection string for Prisma | Required |
| **Blockchain (Stellar/Soroban)** |
| `STELLAR_RPC_URL` | Stellar RPC endpoint | `https://soroban-testnet.stellar.org` |
| `SOROBAN_CONTRACT_ID` | Deployed AidEscrow contract ID | None |
| **AI and verification** |
| `OPENAI_API_KEY` | OpenAI API key for server-side verification | Empty (disabled) |
| `VERIFICATION_MODE` | Verification mode | `client-side` |
| **CORS** |
| `CORS_ORIGINS` | Comma-separated allowed origins | `http://localhost:3000,http://localhost:3001` |
| **Queue and cache** |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `QUEUE_ENABLED` | Enable background job queues | `false` |
| **Security** |
| `JWT_SECRET` | Secret for JWT token signing | Auto-generated |
| `JWT_EXPIRES_IN` | JWT token expiration time | `7d` |
| **Rate limiting** |
| `API_RATE_LIMIT` | Max requests per minute per IP | `100` |
| `THROTTLE_TTL` | Rate limit window (milliseconds) | `60000` |
| `THROTTLE_ENABLED` | Enable request throttling | `true` |
| **Monitoring** |
| `METRICS_ENABLED` | Enable Prometheus metrics at `/metrics` | `false` |
| `LOG_LEVEL` | Logging level | `debug` |
| `SENTRY_DSN` | Sentry DSN for error tracking | None |
| **Feature flags** |
| `SWAGGER_ENABLED` | Enable API docs at `/api/docs` | `true` |

### Troubleshooting

| Problem | Solution |
|---|---|
| Database connection fails | Ensure PostgreSQL is running (`pg_isready`), verify credentials, check database exists |
| Stellar RPC errors | Verify network connectivity, check testnet vs mainnet, ensure testnet XLM balance |
| OpenAI verification not working | Verify `OPENAI_API_KEY`, check credits, ensure `VERIFICATION_MODE=server-side` |
| Queue/Redis errors | Ensure Redis is running (`redis-cli ping`), verify `REDIS_URL` |

---

## API reference

### Verification inbox

**View pending verifications:**
```bash
curl -H "Authorization: Bearer $JWT_TOKEN" \
  http://localhost:3001/api/v1/verification-inbox?status=pending_review
```

**Approve a verification:**
```bash
curl -X POST \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nextStepMessage": "Verification approved. Proceed to disbursement."}' \
  http://localhost:3001/api/v1/verification-inbox/{id}/approve
```

**Reject a verification:**
```bash
curl -X POST \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rejectionReason": "Document appears fraudulent"}' \
  http://localhost:3001/api/v1/verification-inbox/{id}/reject
```

### Ledger operations

**Trigger a backfill for missing ledger ranges:**
```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"startLedger": 1000, "endLedger": 2000, "batchSize": 100}' \
  http://localhost:3001/api/v1/admin/ledger/backfill
```

**Trigger reconciliation to detect discrepancies:**
```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"startLedger": 1000, "endLedger": 2000, "thresholdPercent": 5}' \
  http://localhost:3001/api/v1/admin/ledger/reconcile
```

---

## Monitoring and observability

### Prometheus metrics

```bash
curl http://localhost:3001/metrics
```

Key metrics:
- `http_requests_total` — Total HTTP requests by method, route, status code
- `http_request_duration_seconds` — Request latency histogram with SLO-tuned buckets (25 ms / 50 / 100 / 250 / 500 / 1 000 / 2 500 / 5 000 / 10 000 ms) for p99 alerting per route
- `error_rate_total` — Error count across all systems
- `ingestion_lag_seconds` — Time between event creation and processing
- `webhook_retries_total` — Webhook delivery retry count
- `jobs_processed_total` / `jobs_failed_total` — Background job success/failure rates
- `onchain_operations_total` — On-chain operation counts by status

#### Tail-latency SLO dashboard

A Grafana dashboard for p99 / p95 / p50 per route is committed to the repository:

```
docs/observability/api-latency.json
```

Import it into Grafana via **Dashboards → Import → Upload JSON file** and select your Prometheus datasource. The dashboard provides:

- **SLO stat panels** — current p99, p95, p50 across all routes with colour-coded thresholds
- **p99 / p95 / p50 time-series per route** — filterable by route and HTTP method
- **Bucket distribution panel** — shows observations spread across the 9 SLO buckets so you can confirm the histogram is healthy
- **Slowest routes table** — sortable by p99 for quick triage
- **Request rate and error rate panels** — 4xx/5xx breakdown per route

PromQL to alert on p99 SLO breach (> 1 s):

```promql
histogram_quantile(0.99,
  sum by (le, route, method)(
    rate(http_request_duration_seconds_bucket[5m])
  )
) > 1
```

### Structured logging

Log entries include:
- `request_id` — Unique identifier for each request (from X-Request-ID header)
- `user_id` — User identifier from JWT token
- `route` — HTTP method and path
- `duration_ms` — Request processing time in milliseconds
- `correlationId` — Tracks async operations across services

### Security headers

Verify security headers in production:
```bash
curl -I http://localhost:3001/api/v1/health
```

Expected headers:
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Content-Security-Policy` with strict directives
- `Referrer-Policy: strict-origin-when-cross-origin`

---

## Incident response

**High error rate detected:**
1. Check `error_rate_total` metrics breakdown by error type
2. Review logs for error patterns using `request_id` correlation
3. If on-chain failures: check Stellar RPC endpoint status
4. If webhook failures: verify external service availability

**Ingestion lag increasing:**
1. Monitor `ingestion_lag_seconds` gauge
2. Check queue depth: `curl http://localhost:3001/api/v1/jobs/status`
3. If lag exceeds 60 seconds: trigger backfill for affected ledger ranges
4. Run reconciliation to identify missing data

**Webhook delivery failures:**
1. Check `webhook_retries_total` by reason
2. Verify external service endpoints are accessible
3. Check authentication credentials for external services
4. Review webhook payload sizes (may exceed limits)

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines and coding conventions.

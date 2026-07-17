# ChainForge

**Transparent humanitarian aid delivery, powered by Stellar.**

ChainForge is an open-source platform that combines on-chain escrow, off-chain AI verification, and field-ready mobile tools to deliver humanitarian aid directly to recipients — with full transparency from funding to final disbursement.

Built on the Stellar ecosystem (Soroban smart contracts), ChainForge ensures every aid package is traceable, every claim is verifiable, and every disbursement is auditable.

---

## Why ChainForge

Humanitarian aid distribution faces three persistent challenges: **lack of transparency**, **fraudulent claims**, and **inefficient disbursement**. ChainForge addresses all three:

- **Transparency** — Every aid package, claim, and disbursement is recorded on-chain via Soroban smart contracts, creating an immutable audit trail.
- **Verification** — AI-powered document analysis, proof-of-life checks, fraud detection, and PII anonymization ensure claims are legitimate before disbursement.
- **Field readiness** — Mobile apps with QR scanning and offline support let field operators verify recipients and process claims in remote areas.

---

## Architecture

The platform is composed of five distinct services:

| Service | Stack | Role |
|---|---|---|
| **Smart Contracts** | Rust + Soroban | On-chain escrow, claim, and disbursement logic |
| **Backend** | NestJS + Prisma | API orchestration, persistence, role-based access |
| **Frontend** | Next.js + Tailwind | Admin dashboard, campaign management, reporting |
| **Mobile** | Expo + WalletConnect | Field operations, QR scanning, recipient flows |
| **AI Service** | FastAPI + Pydantic | OCR, anonymization, fraud detection, humanitarian verification |

```text
ChainForge/
├── .github/workflows/        # CI/CD pipelines
├── app/
│   ├── onchain/              # Soroban smart contracts (Rust)
│   ├── backend/              # NestJS API server
│   ├── frontend/             # Next.js web application
│   ├── mobile/               # Expo React Native app
│   └── ai-service/           # FastAPI inference service
├── assets/                   # Repository assets
├── tools/                    # Developer tooling & scripts
└── docs/                     # Runbooks & documentation
```

---

## Core capabilities

### On-chain escrow
- Create, claim, disburse, revoke, and refund aid packages via Soroban contracts
- Indexer-friendly events for transparency and analytics
- Testnet guardrails to prevent cross-network mismatches

### AI-powered verification
- Document OCR and field extraction from uploaded evidence
- Proof-of-life analysis with facial matching
- Fraud detection and duplicate claim checking
- PII anonymization before external LLM processing

### Operational tooling
- Campaign management with review workflows and status tracking
- Role-based access control for administrators, operators, and auditors
- Webhook notifications for task completion and status updates
- Observability hooks with Prometheus metrics and structured logging

### Field operations
- QR-based package scanning for quick recipient identification
- WalletConnect v2 integration for secure Stellar wallet connections
- Offline-capable claim submission with background sync
- Real-time system health monitoring

---

## Getting started

### Prerequisites

- Node.js 18+
- Python 3.11+
- Rust toolchain with Soroban CLI
- Docker (optional, for containerized development)

### Quick start

```bash
# Clone the repository
git clone https://github.com/ChainForgee/ChainForge.git
cd ChainForge

# Start the backend
cd app/backend
npm ci && cp .env.example .env
npm run prisma:migrate && npm run start:dev

# In a new terminal — start the frontend
cd app/frontend
pnpm install && cp .env.example .env.local
pnpm dev

# In a new terminal — start the AI service
cd app/ai-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

See the individual service READMEs for detailed setup instructions and configuration guides.

---

## Testing

```bash
# Backend
cd app/backend && npm test && npm run test:e2e

# Frontend
cd app/frontend && pnpm lint && pnpm type-check && pnpm test

# Mobile
cd app/mobile && pnpm test && pnpm lint

# AI service
cd app/ai-service && pytest

# Smart contracts
cd app/onchain && make test
```

---

## Documentation

- **Smart contracts** — [onchain README](app/onchain/README.md) covers contract methods, events, and deployment
- **Backend API** — [backend README](app/backend/README.md) covers endpoints, auth, and environment configuration
- **Frontend** — [frontend README](app/frontend/README.md) covers component architecture and state management
- **Mobile** — [mobile README](app/mobile/README.md) covers deep linking, QR scanning, and offline behavior
- **AI service** — [ai-service README](app/ai-service/README.md) covers inference pipelines and provider configuration
- **Testnet deployment** — [deployment runbook](docs/testnet-deploy-runbook.md) covers end-to-end testnet setup

---

## Contributing

We welcome contributions that make humanitarian aid delivery more transparent and efficient.

Please read our [End-to-End Contributor Journey](docs/contributing/journey.md) for a complete walk-through of finding an issue, local setup, PR conventions, CI expectations, and the merge process.

When submitting changes:

1. Open an issue to discuss the proposed change before implementing
2. Keep pull requests small and focused on a single concern
3. Include tests for new functionality and update existing tests as needed
4. Ensure no secrets, keys, or seed phrases are committed
5. Follow the coding conventions and style guides documented in each service's README

For component-specific contribution guidelines, refer to the README in each `app/` subdirectory.

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

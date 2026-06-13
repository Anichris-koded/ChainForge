# ChainForge Frontend

Modern, responsive web interface for transparent humanitarian aid distribution on the Stellar blockchain, built with Next.js.

The frontend serves as the user-facing portal for donors, administrators, and operators to create and manage aid campaigns, review verification submissions, interact with Soroban smart contracts, and monitor distribution activity.

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5.9 |
| Styling | Tailwind CSS 4 |
| UI primitives | Radix UI |
| Data fetching | TanStack React Query |
| Mapping | Leaflet + React-Leaflet |
| Blockchain | Stellar SDK, Freighter Wallet API |
| Linting | ESLint 9 |
| i18n | next-intl (en, es, fr) |

---

## Project structure

```
src/
├── app/               # Next.js App Router pages
│   ├── [locale]/      # Localized routes (en, es, fr)
│   ├── api/           # API routes (health, etc.)
│   ├── layout.tsx     # Root layout with providers
│   └── globals.css    # Global styles
├── components/        # React components
│   ├── ui/            # Reusable primitives (Radix-based)
│   └── features/      # Domain-specific components
├── lib/               # Utilities, API clients, providers
├── hooks/             # Custom React hooks
├── types/             # TypeScript type definitions
├── messages/          # i18n translation files
└── config/            # Configuration
```

---

## Getting started

### Prerequisites

- Node.js 18+
- pnpm (preferred) or npm
- Freighter browser extension (for wallet integration)

### Installation

```bash
# From the monorepo root
pnpm install

# Or from this directory
cd app/frontend && pnpm install
```

### Environment setup

```bash
cp .env.example .env.local
```

Configure key variables:

```bash
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_STELLAR_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_AID_ESCROW_CONTRACT_ID=your_contract_id
```

The navbar displays a network and environment indicator so contributors always know which Stellar network and app environment they are targeting. These values come from `NEXT_PUBLIC_STELLAR_NETWORK` and optional `NEXT_PUBLIC_ENV_NAME` — they are safe to expose in production.

### Development

```bash
pnpm dev
# or: pnpm --filter frontend dev (from monorepo root)
```

Open [http://localhost:3000](http://localhost:3000) — hot reload is enabled.

### Production build

```bash
pnpm build
pnpm start
```

---

## Available scripts

| Script | Purpose |
|---|---|
| `dev` | Start development server (port 3000) |
| `build` | Create optimized production build |
| `start` | Serve production build locally |
| `lint` | Run ESLint (zero-warnings policy) |
| `type-check` | TypeScript compiler check (`--noEmit`) |
| `test` | Run Jest test suite |

---

## Key features

### React Query

Configured with 60-second stale time and refetch-on-window-focus disabled. Provider in `src/lib/query-provider.tsx`.

### Radix UI components

Pre-installed primitives: Dialog, Dropdown Menu, Select, Toast, Avatar, Slot. Components live in `src/components/ui/`.

### Leaflet maps

Leaflet requires client-side rendering. Use dynamic imports with `ssr: false`:

```tsx
const AidMap = dynamic(() => import('@/components/maps/AidMap'), { ssr: false });
```

### Wallet integration

```tsx
import { isConnected, getPublicKey } from '@stellar/freighter-api';

const hasWallet = await isConnected();
const publicKey = await getPublicKey();
```

### Internationalization

The app supports English, Spanish, and French via `next-intl`. Translation files live in `src/messages/`. Add a new locale by creating a JSON file there and configuring the middleware.

### Mock API

When the backend is unavailable, enable the mock API layer:

```bash
NEXT_PUBLIC_USE_MOCKS=true
```

The app intercepts requests to supported endpoints (e.g., `/health`, `/aid-packages`) and returns realistic fixtures defined in `src/lib/mock-api/handlers.ts`.

---

## Health check

```http
GET /api/health
```

Response:

```json
{
  "status": "ok",
  "timestamp": "2026-01-19T00:00:00.000Z",
  "service": "chainforge-frontend"
}
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Port 3000 in use | `pnpm dev -- -p 3001` |
| Hydration errors | Wrap Leaflet/Freighter components with `dynamic(..., { ssr: false })` |
| ENV vars undefined | Must start with `NEXT_PUBLIC_`; restart dev server after changes |
| Type errors | Check `@types/leaflet` is installed; run `pnpm type-check` |
| Stale builds | `rm -rf .next && pnpm install` |

---

## Deployment

### Vercel

1. Connect your GitHub repository to Vercel
2. Set root directory to `app/frontend`
3. Configure environment variables in the Vercel dashboard
4. Deploy

```bash
cd app/frontend
vercel --prod
```

---

## Testing

- **Unit and integration:** Jest + React Testing Library
- **E2E** (planned): Playwright

---

## Related documentation

- [Root README](../../README.md) — Project overview
- [Backend README](../backend/README.md) — API documentation
- [On-Chain README](../onchain/README.md) — Smart contract reference
- [Contributing Guide](./CONTRIBUTING.md) — Development workflow

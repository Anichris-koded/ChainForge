# ChainForge Mobile

Field operations application for humanitarian aid distribution, built with Expo and TypeScript.

ChainForge Mobile empowers field operators, NGO workers, and recipients to interact with on-chain aid packages directly from their mobile devices. The app supports QR-based package scanning, WalletConnect v2 integration, biometric security, and real-time system health monitoring.

---

## Features

- **Home screen** — Quick overview, wallet connection, and primary actions
- **QR scanner** — Scan `chainforge://` deep links to view and claim aid packages
- **Bulk scanner** — High-throughput scanning for field operators processing multiple packages
- **Health screen** — Real-time system diagnostics with environment indicator and mock-data fallback
- **Wallet integration** — WalletConnect v2 pairing with compatible Stellar wallets (Lobstr, Freighter, Beans)
- **Biometric lock** — Face ID and fingerprint protection for sensitive aid details
- **Saver mode** — Automatic data-saving mode on slow or metered connections
- **Offline queue** — Claim confirmations queued and retried when connectivity is restored

---

## Setup

### Prerequisites

- Node.js 18+
- pnpm or npm
- Expo CLI (`npm install -g expo-cli`)
- iOS Simulator (macOS) or Android Emulator, or a physical device with Expo Go

### Installation

```bash
cd app/mobile
pnpm install
```

### Environment variables

```bash
cp .env.example .env
```

All Expo public variables use the `EXPO_PUBLIC_` prefix and are safe to ship in any build.

| Variable | Required | Default | Description |
|---|---|---|---|
| `EXPO_PUBLIC_API_URL` | Yes | `http://localhost:3000` | Backend API base URL |
| `EXPO_PUBLIC_ENV_NAME` | No | auto-inferred | Environment label (`dev`, `staging`, `prod`) |
| `EXPO_PUBLIC_NETWORK` | No | `testnet` | Stellar network identifier |
| `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` | Yes* | — | WalletConnect v2 project ID |
| `EXPO_PUBLIC_SOROBAN_CONTRACT_ID` | No | — | Deployed AidEscrow contract ID |

* Required for wallet pairing flows.

#### API URL examples

```bash
# iOS Simulator
EXPO_PUBLIC_API_URL=http://localhost:3000

# Android Emulator
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000

# Physical device (use LAN IP)
EXPO_PUBLIC_API_URL=http://192.168.1.10:3000

# Production
EXPO_PUBLIC_API_URL=https://api.chainforge.app
```

### Deep link scheme

The app registers the `chainforge://` custom scheme for QR code scanning and wallet return flows:

- **Package links**: `chainforge://package/{aidId}`
- **Wallet callbacks**: `chainforge://wallet/callback`

### WalletConnect setup

1. Create a project at [WalletConnect Dashboard](https://dashboard.walletconnect.com)
2. Set `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` in `.env`
3. Build a development client or production build to register the `chainforge://` scheme

```bash
EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id
EXPO_PUBLIC_WALLETCONNECT_STELLAR_CHAIN_ID=stellar:testnet
```

### Running

```bash
pnpm start          # Expo dev server
pnpm android        # Android emulator / device
pnpm ios            # iOS simulator / device
pnpm web            # Web browser preview
```

---

## Health screen

The health screen fetches backend status from `${EXPO_PUBLIC_API_URL}/health`. If the backend is unreachable, it falls back to mock data with a mock badge and troubleshooting tips. An environment badge in the top-right header and footer row display the active configuration:

```
Environment: dev · localhost:3000
```

---

## Available scripts

| Script | Purpose |
|---|---|
| `pnpm start` | Start Expo dev server with Metro bundler |
| `pnpm android` | Run on Android emulator or device |
| `pnpm ios` | Run on iOS simulator or device |
| `pnpm web` | Run in web browser for testing |
| `pnpm test` | Run Jest test suite |
| `pnpm lint` | Run ESLint for code quality |

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Connection refused | Use machine's LAN IP for physical devices |
| Metro not starting | Clear cache: `expo start -c` |
| Wrong environment | Verify `.env` values, restart Metro with `-c` |
| WalletConnect fails | Confirm `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID` is set |

For detailed development workflow and testing procedures, see [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## Related documentation

- [Root README](../../README.md) — Project overview
- [Backend README](../backend/README.md) — API documentation
- [On-Chain README](../onchain/README.md) — Smart contract reference

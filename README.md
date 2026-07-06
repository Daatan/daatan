# DAaTAn

**Reputation-based news prediction platform**

> "Prove you were right — without shouting into the void."

[![Live](https://img.shields.io/badge/Production-daatan.com-green)](https://daatan.com)
[![Staging](https://img.shields.io/badge/Staging-staging.daatan.com-yellow)](https://staging.daatan.com)
[![Version](https://img.shields.io/badge/Version-1.29.4-blue)](https://github.com/Daatan/daatan/releases)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)

---

## What Is DAaTAn?

DAaTAn is a reputation-based product that enables testing understanding and forecasts on news, politics, and current affairs — **without money**, with long-term accuracy measurement.

**The product doesn't measure profit — it measures understanding.**

---

## Environments

| Environment | URL | Branch | Deploy Trigger |
|-------------|-----|--------|----------------|
| **Production** | https://daatan.com | `main` | Push tag `v*` |
| **Staging** | https://staging.daatan.com | `main` | Push to `main` |

---

## What DAaTAn Is NOT

- ❌ Not a gambling platform
- ❌ Not a trading arena
- ❌ Not a real-money product
- ❌ Not a consequence-free game

---

## Tech Stack

| Layer | Technology |
| ----- | ---------- |
| Framework | Next.js 15 (React 18) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS |
| Database | PostgreSQL 16 + Prisma 7.x |
| Auth | NextAuth.js (Google OAuth) |
| Hosting | AWS EC2 (eu-central-1) |
| Storage | AWS S3 (avatars) |
| LLM | Gemini (primary), Ollama (fallback), OpenRouter (bots) |
| Forecast Oracle | TruthMachine Oracle API (`oracle.daatan.com`) — calibrated multi-source probability estimates |
| Prompt Mgmt | AWS Bedrock Prompt Management |
| Container | Docker + Nginx |
| CI/CD | GitHub Actions |
| SSL | Let's Encrypt |

---

## Quick Start

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Open http://localhost:3000
```

---

## Scripts

### Development
```bash
npm run dev        # Start dev server
npm run build      # Build for production
npm run lint       # Run linter
npm run typecheck  # Type check
npm test           # Run unit tests
```

### Operations
```bash
./scripts/check.sh    # Quick health check (up/down)
./scripts/status.sh   # Full status (health, version, latency)
./scripts/release.sh  # Create version tag and release
```

### Deployment
```bash
# Deploy to staging (automatic on push to main)
git push origin main

# Deploy to production (create version tag)
./scripts/release.sh
# Or manually:
git tag v1.1.1
git push origin v1.1.1
```

## Development Workflow

1. **Local dev:** `npm run dev`.
2. **Commit:** a husky pre-commit hook runs `scripts/check-version-bump.sh` and `lint-staged` (ESLint `--fix` on staged TS/TSX).
3. **Push:** a husky pre-push hook runs `tsc --noEmit` (typecheck) and `vitest run --changed` (tests related to changed files; integration tests excluded).
4. **Deploy staging:** push to `main`.
5. **Deploy production:** run `./scripts/release.sh` to tag `vX.Y.Z` and create a GitHub release.

---

## Documentation

| Document | Purpose |
| -------- | ------- |
| [DAATAN_CORE.md](./DAATAN_CORE.md) | Source of Truth — vision and principles |
| [TECH.md](./TECH.md) | Technical architecture, infrastructure, and project structure |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Deployment procedures and operations |
| [SECRETS.md](./SECRETS.md) | Secrets management and security |
| [PRODUCT.md](./PRODUCT.md) | Product vision and feature documentation |
| [FORECASTS_FLOW.md](./FORECASTS_FLOW.md) | End-to-end forecast creation and resolution flow |
| [public/docs/forecast-pipeline.html](./public/docs/forecast-pipeline.html) | Visual diagram of the Create + Analyze pipelines — served live (noindex) at [daatan.com/docs/forecast-pipeline.html](https://daatan.com/docs/forecast-pipeline.html) ([staging](https://staging.daatan.com/docs/forecast-pipeline.html)) |
| [GLOSSARY.md](./GLOSSARY.md) | Terminology definitions |
| [VERSIONING.md](./VERSIONING.md) | Semantic versioning rules |
| [TESTING.md](./TESTING.md) | Testing strategy and guidelines |
| [SECURITY.md](./SECURITY.md) | Security policy and vulnerability reporting |
| [TODO.md](./TODO.md) | Active development tasks |
| [POST_MORTEM.md](./POST_MORTEM.md) | Incident history and retrospectives |
| [docs/bots.md](./docs/bots.md) | Autonomous bot system design and usage |
| [docs/BOT_APPROVAL_WORKFLOW.md](./docs/BOT_APPROVAL_WORKFLOW.md) | Bot approval workflow (v1.7.31+) |
| [docs/LLM_ARCHITECTURE.md](./docs/LLM_ARCHITECTURE.md) | LLM provider chain, Bedrock prompts, Oracle integration |
| [docs/API.md](./docs/API.md) | HTTP API reference |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Deployment pipeline (canonical) |
| [docs/ROLLBACK.md](./docs/ROLLBACK.md) | Rollback procedures |
| [INFRASTRUCTURE_SPLIT.md](./INFRASTRUCTURE_SPLIT.md) | Prod / staging EC2 split |
| [docs/TROUBLESHOOTING-AUTH.md](./docs/TROUBLESHOOTING-AUTH.md) | Auth troubleshooting |

---

## Contributing

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Validate against [DAATAN_CORE.md](./DAATAN_CORE.md)
3. Make changes and commit
4. Push and create a Pull Request
5. **Never merge without explicit approval**

---

## License

Private — All rights reserved.

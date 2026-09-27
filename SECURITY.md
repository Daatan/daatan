# Security Policy

## Supported versions

Daatan is deployed as a rolling single-tenant service at [daatan.com](https://daatan.com). Only the **latest released tag** (currently the [latest GitHub release](https://github.com/Daatan/daatan/releases/latest)) is supported — older tags receive no security fixes. Staging at [staging.daatan.com](https://staging.daatan.com) tracks `main` and is always at or ahead of production.

| Scope | Supported |
| ----- | --------- |
| Latest `vX.Y.Z` release (production) | ✅ |
| `main` branch (staging) | ✅ |
| Any previous tag | ❌ |

## Reporting a vulnerability

If you believe you've found a security issue, **please do not open a public GitHub issue**. Instead:

- Email: **security@daatan.com** (preferred), or
- Open a [private security advisory](https://github.com/Daatan/daatan/security/advisories/new) on this repository.

Please include:

- a clear description of the issue,
- steps to reproduce (or a proof-of-concept),
- the impact you believe it has,
- any mitigation you've already considered.

You can expect:

- an initial acknowledgement within **72 hours**,
- a triage decision (accept / decline / need-more-info) within **7 days**,
- for accepted issues: a fix or mitigation plan, with regular updates until resolution and a credit in the release notes if you'd like one.

Please give us a reasonable window to remediate before any public disclosure.

## Scope

In scope:

- the `daatan.com` and `staging.daatan.com` web applications,
- the `oracle.daatan.com` API (source in the separate [retro](https://github.com/Daatan/retro) repo; coordinate with us and we'll route appropriately),
- the HTTP API under `/api/*` (see [docs/API.md](./docs/API.md)),
- the bot-runner cron and admin endpoints,
- any code in this repository.

Out of scope:

- denial-of-service via volumetric traffic against public endpoints,
- social engineering of Daatan staff,
- findings that require physical access to infrastructure,
- reports from automated scanners without a concrete exploit path,
- third-party services we integrate with (Google OAuth, Gemini, OpenRouter, etc.) — report those to the vendor.

## Hardening notes

Operators running their own fork should review:

- [SECRETS.md](./SECRETS.md) — how secrets are stored (AWS Secrets Manager bundles, pulled at deploy time) and [docs/SECRETS.md](./docs/SECRETS.md) — per-item SSM SecureStrings and who can read what.
- [docs/SELF_HOSTING.md](./docs/SELF_HOSTING.md) — the self-hosted edition (`DAATAN_EDITION=self_hosted`), for running your own install.
- [INFRASTRUCTURE_SPLIT.md](./INFRASTRUCTURE_SPLIT.md) — EC2 access is SSM-only; port 22 is closed.
- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) — GitHub OIDC role assumption, no long-lived AWS keys in CI.
- [docs/ROLLBACK.md](./docs/ROLLBACK.md) — rollback workflow for incident response.

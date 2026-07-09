# LLM Architecture & Fallback Strategy

## Overview

The application uses a **Resilient LLM Service** that abstracts the underlying AI providers. This ensures high availability by automatically falling back to secondary providers if the primary one fails.

## Provider Chain

The main `llmService` tries providers in this order; each leg is **registered only when it's configured**, so a call is never single-provider in practice. The fallbacks are deliberately cross-vendor — a Google/Gemini outage takes down neither the Oracle (AWS Bedrock) nor the OpenRouter free Llama leg.

1.  **Primary**: **Google Gemini** (`gemini-2.5-flash`)
    *   Fast, cost-effective, high quality. Requires `GEMINI_API_KEY` (skipped in CI/test where it's unset).

2.  **Fallback 1**: **Oracle `/llm`** (**AWS Bedrock / Amazon Nova**, `bedrock/amazon.nova-pro-v1:0`)
    *   Calls the retro Oracle's `POST /llm` via `getOracleConfig()` + `oracleFetch`. A *different vendor* from Google, so it serves precisely during a Gemini/Google outage.
    *   Registered whenever the Oracle is configured (`ORACLE_URL` + `ORACLE_API_KEY`) — a no-op otherwise (e.g. self-host installs that don't reach Daatan's Oracle).
    *   No native JSON-schema mode: `schema` requests are steered with a system message (the caller still parses the JSON).

3.  **Fallback 2**: **OpenRouter**
    *   Registered whenever a key is configured (admin setting → env), for **both** editions.
    *   **SaaS**: added only as a last-resort backstop, so it uses the free **non-Google** model `meta-llama/llama-3.3-70b-instruct:free` (an OpenRouter *Gemini* model would still hit Google's backend and die in the same outage).
    *   **Self-host**: runs as a primary user-facing provider on the admin-chosen `getOpenRouterModel()`.

4.  **Fallback 3**: **Ollama** (hosting `qwen2.5:7b`)
    *   Self-hosted, private, no per-token cost. **Registered only when `OLLAMA_BASE_URL` is explicitly set** — the old implicit `localhost:11434` default was dropped so hosts that don't run Ollama (e.g. prod) don't carry a dead provider slot that fails on every fallback.

**Bots** use a separate service, `createBotLLMService(modelPreference)`, with its own Gemini + OpenRouter chain for per-bot model selection (requires `OPENROUTER_API_KEY`). It is unchanged by the above.

### Failure notifications

A single provider failing is **logged but not paged** — a later leg may still succeed, and a fallback that rescues the call is silent. Telegram is paged (via `notifyLlmError`) **only when the whole chain fails**, with the attempted provider chain (e.g. `Gemini → Oracle → OpenRouter`) and the last error. See `docs/TELEGRAM_NOTIFICATIONS.md`.

## Code Structure

*   **`src/lib/llm/types.ts`**: Interfaces for `LLMProvider`, `LLMRequest`, `LLMResponse`.
*   **`src/lib/llm/providers/`**: Implementations for specific services.
    *   `gemini.ts`: Wrapper for Google Generative AI SDK.
    *   `oracle.ts`: HTTP client for the Oracle `/llm` endpoint (Bedrock/Nova) — main-chain fallback.
    *   `ollama.ts`: HTTP client for Ollama API.
    *   `openrouter.ts`: HTTP client for OpenRouter API (main-chain fallback + bots).
*   **`src/lib/llm/service.ts`**: `ResilientLLMService` class that handles the retry/fallback logic.
*   **`src/lib/llm/bedrock-prompts.ts`**: AWS Bedrock Prompt Management client (5-minute TTL cache).
*   **`src/lib/llm/index.ts`**: Instantiates and exports `llmService` and `createBotLLMService`.

## Bedrock Prompt Management

LLM prompts are managed via **AWS Bedrock Prompt Management** rather than local files. The flow is:

```
SSM Parameter Store             Bedrock Prompt Management
/daatan/{env}/prompts/{name}  →  arn:aws:bedrock:...:prompt/{ID}:{version}
        ↓                                    ↓
  bedrock-prompts.ts  ←──── GetPromptCommand ────────────────────────
  (5-min TTL cache)
        ↓
  prompt template string
  (with {{variable}} placeholders)
```

Usage:
```typescript
import { getBedrockPrompt } from '@/lib/llm/bedrock-prompts'

const prompt = await getBedrockPrompt('express-prediction')
// Returns the prompt template string; falls back to hardcoded string if SSM=PLACEHOLDER
```

**Fallback behavior**: if the SSM value is `PLACEHOLDER` or the Bedrock fetch fails, a hardcoded fallback prompt is used so the app never breaks.

**To update a prompt**: edit the DRAFT in the Bedrock console → create a new version → update the SSM parameter to the new ARN. The cache clears within 5 minutes.

See `docs/bots.md` → [Bedrock Prompts Catalog](bots.md#bedrock-prompts-catalog) for the full list of prompt names, IDs, and SSM keys.

Requires `AWS_REGION` and an IAM role/profile with `bedrock:GetPrompt` and `ssm:GetParameter` permissions.

## Usage

### Standard requests (Gemini → Oracle → OpenRouter → Ollama fallback)

Instead of importing `GoogleGenerativeAI` directly, use the service:

```typescript
import { llmService } from '@/lib/llm'

const response = await llmService.generateContent({
  prompt: "Your prompt here",
  schema: optionalJsonSchema, // Gemini supports this natively; Ollama uses JSON mode
  temperature: 0.7
})

console.log(response.text)
```

### Bot requests (OpenRouter)

```typescript
import { createBotLLMService } from '@/lib/llm'

const botLlm = createBotLLMService('mistralai/mixtral-8x7b')
const response = await botLlm.generateContent({ prompt: "..." })
```

## Adding a New Provider

1.  Create a class in `src/lib/llm/providers/` implementing `LLMProvider`.
2.  Add it to the initialization list in `src/lib/llm/index.ts`.

## Oracle API Integration

Calibrated probability estimates for binary forecast questions come from the **TruthMachine Oracle API** (`oracle.daatan.com`) — a FastAPI microservice in the [retro repo](https://github.com/Daatan/retro) that runs a multi-source article ingest + gatekeeper + extractor pipeline with credibility-weighted aggregation.

### Client

*   **`src/lib/services/oracle.ts`**: Oracle client.
    *   `getOracleForecast(question)` → `OracleForecastResponse | null`. Returns the full payload (`mean`, `std`, `ci_low`, `ci_high`, `articles_used`, `sources[]` with per-source `stance` / `certainty` / `credibility_weight` / `claims`) so callers can surface provenance alongside the probability. Never throws; returns `null` on any failure so callers can fall back silently.
    *   `getOracleProbability(question)` → `number | null` in `[0, 1]`. Thin wrapper around `getOracleForecast` for callers that only need the scaled probability.
    *   `checkOracleHealth()` → `boolean`. Verifies the API is reachable and its version starts with `0.1`.

### Persistence & UI surfacing

When the Oracle path produces a probability for `POST /api/forecasts/[id]/context`, the full payload is persisted on the `ContextSnapshot.oracleSnapshot` JSON column (camelCased: `{ mean, std, ciLow, ciHigh, articlesUsed, sources: [...] }`, all top-level values 0–100 percent — uniform across historical rows since the 2026-07-08 normalization). Persistence — from this path and every other estimate writer (news-indexer push, backfill, requote clock, creation) — goes through the single `recordEstimate` funnel in `src/lib/services/context.ts`, which stamps `origin`/`articlesUsed` on the snapshot and keeps `Prediction.confidence`/`aiCiLow`/`aiCiHigh` consistent (see [docs/DATABASE.md](./DATABASE.md)). The forecast detail page consumes this snapshot to render a translucent 95% CI band on the speedometer around the AI tick, inline CI text in the "AI estimate" block (e.g. `64% (95% CI: 52–76%)`), and an "Oracle sources" sub-section that chips each source with a credibility-weight dot (green ≥ 0.75, amber 0.4–0.75, grey < 0.4) and a `YES` / `NO` / `—` stance badge. LLM-fallback snapshots have `oracleSnapshot = null` and the UI gracefully hides the Oracle-only affordances.

### Fallback chain for forecast "AI %"

1.  **Oracle** (`POST /forecast` with 12s timeout (bots use 20s)) — calibrated multi-source estimate.
2.  **LLM `guessChances`** (Gemini → Oracle → OpenRouter → Ollama via the provider chain above) — used if the forecast Oracle path is not configured, times out, returns a placeholder response, or has zero usable articles.

### Call sites

*   `POST /api/forecasts/[id]/context` — step 3 "AI probability" in the context analysis route.
*   `POST /api/forecasts/express/guess` — the express forecast guess endpoint.

In both routes, Oracle is tried first; if it returns `null`, the existing `guessChances` path runs unchanged.

### Configuration

| Env var | Required? | Notes |
|---------|-----------|-------|
| `ORACLE_URL` | Optional | Defaults to unconfigured (falls back to LLM). Set to `https://oracle.daatan.com` to enable. |
| `ORACLE_API_KEY` | Optional | Must match the `ORACLE_API_KEY` set in `oracle-api.service` on the retro EC2 instance. Stored in AWS Secrets Manager at `openclaw/oracle-api-key` — note the `openclaw/` prefix is legacy naming from the decommissioned OpenClaw stack and is retained for backwards compatibility. |

Both are validated in `src/env.ts` and delivered to production/staging via the `daatan-env-prod` / `daatan-env-staging` AWS Secrets Manager bundles, which are pulled to `~/app/.env` on each deploy by `scripts/fetch-secrets.sh`.

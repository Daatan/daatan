# LLM Architecture & Fallback Strategy

## Overview

The application uses a **Resilient LLM Service** that abstracts the underlying AI providers. This ensures high availability by automatically falling back to secondary providers if the primary one fails.

## Provider Chain

The main `llmService` tries providers in this order; each leg is **registered only when it's configured**, so a call is never single-provider in practice. The fallbacks are deliberately cross-vendor — a Google/Gemini outage takes down neither the Oracul (AWS Bedrock) nor the OpenRouter free Llama leg.

1.  **Primary**: **Gemini via Vertex AI** (`gemini-2.5-flash`) — #1472
    *   Same model and the same schemas as the leg below; only the **billing surface** differs. Google is forcing the Gemini *Developer* API from Postpay to **Prepay** (deadline **2026-09-14**), which introduces a prepaid balance that can hit zero and stop extraction. Vertex (`aiplatform.googleapis.com`) stays on GCP Postpay and draws the credits billing account directly, so there is no balance to keep funded.
    *   Registered only when all of `GOOGLE_VERTEX_PROJECT_ID`, `GOOGLE_VERTEX_CLIENT_EMAIL` and `GOOGLE_VERTEX_PRIVATE_KEY` are set (`GOOGLE_VERTEX_LOCATION` defaults to `global`). All-or-nothing: a half-configured service account would register a leg that fails every call and burns a retry before falling through.
    *   **REST, not an SDK** (`src/lib/llm/providers/vertex.ts`). Vertex accepts the identical `responseMimeType`/`responseSchema` generation config, so every existing `Schema` in `llm/schemas/`, `llm/gemini.ts`, moderation, the bots and the temporal classifier carries over untouched — the migration needs **no** `@google/generative-ai` → Vertex-SDK swap across call sites. Auth is a service-account JWT exchanged for a `cloud-platform` access token by `src/lib/services/google-auth.ts`, the same mechanism `indexnow.ts` has used for the Indexing API all along (tokens cached per email+scope; the exchange is two round-trips and an RSA signature, far too expensive per call).

2.  **Fallback 0**: **Google Gemini, Developer API** (`gemini-2.5-flash`) — *self-host only*
    *   The original key-based leg. Requires `GEMINI_API_KEY` (skipped in CI/test where it's unset).
    *   **Not registered on daatan.com since #1472**: Vertex was verified in production (v1.65.192) and `GEMINI_API_KEY` was then removed from the prod and staging bundles, so the SaaS chain now falls from Vertex straight through to the Oracul/Bedrock leg — a *different vendor*, which is the more useful fallback anyway. The key was the last thing tying the SaaS to the Developer API's forced-Prepay balance.
    *   The leg stays in the code for the **self-host** edition, where an AI Studio key is the easy path and a GCP service account is not available. See [SELF_HOSTING.md](SELF_HOSTING.md).

3.  **Fallback 1**: **Oracul `/llm`** (**AWS Bedrock / Amazon Nova**, `bedrock/amazon.nova-pro-v1:0`)
    *   Calls the retro Oracul's `POST /llm` via `getOracleConfig()` + `oracleFetch`. A *different vendor* from Google, so it serves precisely during a Gemini/Google outage.
    *   Registered whenever the Oracle is configured (`ORACLE_URL` + `ORACLE_API_KEY`) — a no-op otherwise (e.g. self-host installs that don't reach Daatan's Oracle).
    *   No native JSON-schema mode: `schema` requests are steered with a system message (the caller still parses the JSON).

4.  **Fallback 2**: **OpenRouter**
    *   Registered whenever a key is configured (admin setting → SSM `OPENROUTER_API_KEY` → env, `getOpenRouterKey()`), for **both** editions.
    *   **SaaS**: added only as a last-resort backstop, so it uses the free **non-Google** model `meta-llama/llama-3.3-70b-instruct:free` (an OpenRouter *Gemini* model would still hit Google's backend and die in the same outage).
    *   **Self-host**: runs as a primary user-facing provider on the admin-chosen `getOpenRouterModel()`.

5.  **Fallback 3**: **Ollama** (hosting `qwen2.5:7b`)
    *   Self-hosted, private, no per-token cost. **Registered only when `OLLAMA_BASE_URL` is explicitly set** — the old implicit `localhost:11434` default was dropped so hosts that don't run Ollama (e.g. prod) don't carry a dead provider slot that fails on every fallback.

**Timeouts are per leg when the caller asks for it** (#1948): `LLMRequest.legTimeoutMs` gives each provider in the chain its own `AbortSignal.timeout`, so a first leg that burns its budget no longer leaves the next leg starting already aborted; the overall deadline becomes `legTimeoutMs × legs`. A leg timeout is logged as `LLM leg timeout after Nms (<provider>)` and the chain moves on; an aborted *caller* signal stops the chain. Bots pass it (`src/lib/services/bots/shared.ts`); callers without it keep one shared signal.

**Embeddings** do not go through this chain at all — `src/lib/services/embedding.ts` calls `gemini-embedding-2` directly, preferring Vertex on the same credentials and falling back to the Developer API. See [EMBEDDINGS.md](EMBEDDINGS.md).

**Bots** use a separate service, `createBotLLMService(modelPreference)`, with its own Gemini + OpenRouter chain for per-bot model selection (requires `OPENROUTER_API_KEY`). A Gemini-preference bot tries Vertex first (#1879/#1888 — daatan.com carries no `GEMINI_API_KEY` since #1472, so without this leg such a bot had zero Google providers), then the direct Developer-API leg when `GEMINI_API_KEY` is set (self-host), then the free non-Google OpenRouter model.

**The AI panel (LASSO)** does not use this chain either: `src/lib/llm/panel/client.ts` calls each roster member (`src/lib/llm/panel/roster.ts`) on its own route — `openrouter`, `bedrock`, or `vertex` (the Gemini member moved from an OpenRouter `google-vertex` pin to direct Vertex in #1600, and from `gemini-2.5-flash` to `gemini-3.5-flash-lite` in #1763 — a non-thinking model is required because Vertex counts thought tokens against the panel's 64-token cap, so the main chain's model choice does not apply to it). See [LASSO.md](LASSO.md).

**The express grounded-date lookup** (`src/lib/llm/groundedDateLookup.ts`, #1706) is also deliberately outside the chain: it needs Gemini's `googleSearch` tool, which no fallback leg has, so it calls Vertex directly and is skipped when Vertex isn't configured. See [Express prediction date grounding](#express-prediction-date-grounding-1086) below.

### Failure notifications

A single provider failing is **logged but not paged** — a later leg may still succeed, and a fallback that rescues the call is silent. Telegram is paged (via `notifyLlmError`) **only when the whole chain fails**, with the attempted provider chain (e.g. `Gemini → Oracul → OpenRouter`) and the last error. See `docs/TELEGRAM_NOTIFICATIONS.md`.

### Model per stage (#1800)

Every `llmService.generateContent` call names its stage (`forStage('<stage>')`,
`src/lib/llm/stageModels.ts`, the list is `LLM_STAGES`). One env var moves any stage
independently of the rest:

```
LLM_STAGE_MODELS="moderation=gemini-2.5-flash-lite,guess_chances=gemini-3.8-flash"
```

- Unset/empty = every stage on its built-in model (the chain's `GEMINI_MODEL`;
  `research_verdict` → `gemini-2.5-pro`; `grounded_date` → `gemini-2.5-flash`).
- Values are **Google model ids** — they reach the Vertex/Gemini legs only. The non-Google
  fallback legs (Oracul Nova Pro, OpenRouter, Ollama) keep their pinned models.
- Prod: set it in Secrets Manager `daatan-env-prod`, then redeploy — `blue-green-deploy.sh`
  and both compose files pass it (and `EVIDENCE_SECOND_OPINION_MODEL`, which before #1800
  never reached the container at all); empty = default.
- When a later provider rescues a call, `llm: served by fallback provider` is logged at WARN
  with the `stage` — the stage ran on another vendor's model. Not paged.

Not covered, by design: embeddings (`embedding.ts`, `gemini-embedding-2` @ 768 dims — a change
means re-embedding every row), the LLM panel roster (a model change starts a new Brier series)
and bots (`Bot.modelPreference`, per bot in the DB).

## Code Structure

*   **`src/lib/llm/types.ts`**: Interfaces for `LLMProvider`, `LLMRequest`, `LLMResponse`.
*   **`src/lib/llm/providers/`**: Implementations for specific services.
    *   `vertex.ts`: REST client for Gemini on Vertex AI (primary leg; also exports `vertexEnv()` / `vertexEndpoint()` / `vertexAccessToken()` for the panel and the grounded-date lookup).
    *   `gemini.ts`: Wrapper for Google Generative AI SDK (Developer API leg).
    *   `oracle.ts`: HTTP client for the Oracul `/llm` endpoint (Bedrock/Nova) — main-chain fallback.
    *   `ollama.ts`: HTTP client for Ollama API.
    *   `openrouter.ts`: HTTP client for OpenRouter API (main-chain fallback + bots).
*   **`src/lib/llm/service.ts`**: `ResilientLLMService` class that handles the retry/fallback logic.
*   **`src/lib/llm/bedrock-prompts.ts`**: the `PROMPTS` record and `getPromptTemplate()` / `fillPrompt()`. (Name kept from when it fetched from Bedrock; ~26 `getPromptTemplate` call sites.)
*   **`src/lib/llm/index.ts`**: Instantiates and exports `llmService` and `createBotLLMService`.
*   **`src/lib/llm/panel/`**: the AI panel (LASSO) — `roster.ts` (members), `client.ts` (per-route calls), `context.ts` (grounded-indexer snippets).
*   **`src/lib/llm/groundedDateLookup.ts`**: the web-grounded scheduled-event date lookup used by express prediction (#1706).

## Prompts

Prompts live in git — `PROMPTS` in `src/lib/llm/bedrock-prompts.ts`, mirrored in `prompts/*.txt`,
with both the prose and the paired response schema hashed in `prompts/prompt_versions.lock.json`.
No runtime fetch, no cache, no copy outside version control.

```typescript
import { fillPrompt, getPromptTemplate } from '@/lib/llm/bedrock-prompts'

const template = await getPromptTemplate('express-prediction')   // {{appName}} already applied
const prompt = fillPrompt(template, { userInput, currentDate })
```

`getPromptTemplate` still returns a `Promise` so the 39 call sites did not have to change when
#1658 removed the fetch; it cannot fail, and every `PromptName` resolves to text by type.

Full inventory, the two-halves argument, and how to change one: **[docs/PROMPTS.md](PROMPTS.md)**.

Until #1658 this was an SSM → Bedrock Prompt Management lookup with a 5-minute cache and an
in-code fallback. Prompt text that reached production lived in a console git could not see, so
`git revert` rolled back code but not prompts, and two prompts drifted for months. `AWS_REGION`,
`bedrock:GetPrompt` and `ssm:GetParameter` are no longer needed for prompts.

### Express prediction date grounding (#1086)

The model must not invent dates for scheduled events (elections, rulings, statutory deadlines) — it does not reliably know when future events happen. Two layers enforce this:

1. **Prompt rule 3b** in `express-prediction`: a specific event date may appear in the claim or resolution date only when the user's input or the retrieved articles state it; otherwise the claim omits the event date and the deterministic defaults apply (end of current year, or +5 years for relative-timing claims).
2. **`findUngroundedYears()`** (`src/lib/llm/expressPrediction.ts`): after generation, any future year in the claim or resolution date that appears nowhere in the user input or article text — and isn't one of the two defaults — is returned as `ungroundedYears` on the result. The Express review screen renders these as an "Unverified date" warning; editing the claim or the date clears it.
3. **`findClaimTextDeadlineMismatch()`** (`src/lib/utils/extractDatesFromText.ts`, #1706 proposal 5): the same deterministic regex cross-check `POST /api/forecasts` runs to hard-block a claim-text/deadline mismatch at creation (#1404) runs here too and is returned as `claimDeadlineMismatch` — an ISO date, or `null` when the claim has no explicit date phrase or it agrees with `resolveByDatetime`. The review screen renders it as a warning before the author ever reaches the creation endpoint that would reject it.

`dateBasis` (#1706 proposal 1) is a fourth, softer signal in the same family: a self-reported `"explicit_in_claim" | "from_sources" | "assumed"` flag on the schema, surfaced as an "Assumed resolution date" warning when the model couldn't ground the date in anything at all — narrower than `ungroundedYears` (which only fires on an invented year) and orthogonal to `claimDeadlineMismatch` (which only fires when the claim's own text disagrees with the stored deadline).

**Grounded date lookup** (#1706 option 2, `draftWithGroundedDate` in `expressPrediction.ts`): when the first draft reports `dateBasis: "assumed"`, `lookupGroundedEventDate()` (`src/lib/llm/groundedDateLookup.ts`) makes one separate Vertex `gemini-2.5-flash` call with the `googleSearch` tool (15 s budget) to find the date of the officially scheduled event the forecast hinges on. If it finds one, the date is prepended to the articles text as a reference and the forecast is drafted again, so rule 3b can use it like any sourced date. The outcome is returned as `groundedDate` (`{ fired: false }`, `{ fired: true, status: 'no_date' | 'unavailable' }`, or `status: 'found'` with `event`/`date`/`sourceUrl`/`adopted`), recorded in the `ForecastCreationAttempt` details by `POST /api/forecasts/express/generate`, and shown on the review screen as a notice when the re-draft adopted the date. No Vertex, a failed call or no date found all keep the first draft and its "assumed" warning.

### Card headline (#1814)

The feed card shows a short **headline** above the claim; the claim stays canonical wherever
voting or resolution happens. Source: `src/lib/llm/headline.ts`. The prompt (`HEADLINE_PROMPT`)
is built inline in code, so it is **outside** the prompt lock — see
[PROMPTS.md § Prompts outside the lock](PROMPTS.md#prompts-outside-the-lock).

| | |
|---|---|
| Input | the claim text only (a leading emoji such as the bot "🤖" is stripped, then re-added). No details, no articles. |
| Prompt rules | a **self-contained** forecast headline, "as short as possible, but as complete as necessary": subject + outcome, plus timing/condition/scope when dropping it would change the forecast ("Benny Gantz will withdraw from the race before the elections", not "Gantz will withdraw"); about 5–10 words, no minimum, never more than 12 words / 60 chars (two mobile lines); no probability/trailing period; **future tense** with "will" (#1823); neutral, no hint of likelihood or drama; sentence case; keep the claim's polarity; for a question name the contest; same language as the claim. |
| Model | stage `headline` (`forStage('headline')`, see Model per stage), `temperature: 0`, 10 s timeout. |
| Guards | rejected (stored as `''`, card shows the claim) if empty, **> 12 words** (`HEADLINE_MAX_WORDS`) or **> 60 chars** (`HEADLINE_MAX_CHARS`: two lines in the card at 360-375px, measured; the `VarChar(80)` column leaves headroom), or if its negation differs from the claim's (`polarityMatches`, regex on English cues). A polarity mismatch gets **one** retry with `polarityRetryHint` and a 40 s timeout (#1831); an over-long headline gets **one** retry with `shortenRetryHint` ("drop every word that does not change the forecast, keep subject, outcome and any negation/timing/condition"). Every retry result is checked again by all guards. |
| Failure | LLM error or timeout → `null`; the column stays `NULL` and the card shows the claim. Nothing retries it. |
| When it runs | fire-and-forget after create, after canonicalization, and after an English or original-language edit that changes the claim (`services/forecast.ts`); the write is conditional on the claim being unchanged (`updateMany where claimText`), and a claim edit clears the old headline first. |
| Backfill | **Disabled.** `GET /api/cron/backfill-headlines` ([API.md](API.md)) returns `{ ok, disabled: true }` and touches nothing; its nightly workflow was deleted (#2010), so nothing calls it. Already-published forecasts keep their existing headline, or fall back to the claim when it is `NULL`/`''`; they are never regenerated. |
| Translation | translated per locale with `claimText`/`detailsText`/`resolutionRules`, cached against the source hash — see [TRANSLATIONS.md](TRANSLATIONS.md). |
| Storage | `predictions.headline` — see [DATABASE.md](DATABASE.md). |

**Changing the headline** (length, extra information, wording) touches the prompt and the
word/char guards in `headline.ts`, the card layout, and the translation rule for headlines
(`callGeminiTranslate`'s `isHeadline`). The change applies to newly generated headlines only:
stored headlines and their cached translations are not regenerated (#1846), because the
backfill is off and translations are cached against the source hash of the unchanged headline.

## Usage

### Standard requests (Gemini → Oracul → OpenRouter → Ollama fallback)

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

## Oracul API Integration

Calibrated probability estimates for binary forecast questions come from the **TruthMachine Oracle API** (`oracle.daatan.com`) — a FastAPI microservice in the [retro repo](https://github.com/Daatan/retro) that runs a multi-source article ingest + gatekeeper + extractor pipeline with credibility-weighted aggregation.

### Client

*   **`src/lib/services/oracle.ts`**: Oracul client.
    *   `getOraculForecast(question, options?, meta?)` → `OracleForecastResult` (`{ forecast: OracleForecastResponse | null, logId, insufficientData?, failureClass?, outcomeCounts? }`). `forecast` is the full payload (`mean`, `std`, `ci_low`, `ci_high`, `articles_used`, `sources[]` with per-source `stance` / `certainty` / `credibility_weight` / `claims`) so callers can surface provenance alongside the probability. Never throws; `forecast` is `null` on any failure (with `failureClass` saying why) so callers can fall back silently.
    *   `getOraculProbability(question, meta?, options?)` → `number | null` in `[0, 1]`. Thin wrapper around `getOraculForecast` for callers that only need the scaled probability.
    *   `checkOracleHealth()` → `boolean`. Verifies the API is reachable and its version's major component is one of the accepted ones (`EXPECTED_API_MAJOR_VERSIONS`, `['1']` — retro's generation-based 1.4.x, umbrella Daatan/retro#742; the transitional `'0'` added in daatan#1668 was dropped in daatan#1673) — a strict `0.1` prefix check went stale as retro shipped 0.2–0.4.x and was silently failing every call (daatan#1563).

### Funnel diagnostics: `outcomeCounts`

Every `/forecast` response carries retro's per-article stage histogram (`outcome_counts` — `gate_rejected`, `gate_error`, `empty_text`, `extract_error`, `unhandled_error`, `ok`, …). `getOraculForecast` hoists it onto its result as `outcomeCounts` and emits it at **INFO** on all four post-response paths (success, abstain, placeholder, no-usable-articles), alongside `predictionId` and `source`, so a thin pool's cause is queryable in CloudWatch:

```
fields @timestamp, predictionId, source, reason, outcomeCounts
| filter module = 'oracle' and ispresent(outcomeCounts)
```

`reason` only summarises ("the extractor produced nothing"); the histogram is what separates "the gatekeeper rejected all 8" from "6 fetches came back empty and 2 errored". It is response-level, not per-source — it counts articles that never became a source at all, which is exactly the population no per-source field or `EvidencePoolArticle` row can describe, so it is deliberately not persisted on either. An absent or `{}` histogram is reported as `null` rather than an empty object: `{}` is indistinguishable from a retro build too old to send the field, so it must not read as a measurement (daatan#1457).

### Persistence & UI surfacing

When the Oracle path produces a probability for `POST /api/forecasts/[id]/context`, the full payload is persisted on the `ContextSnapshot.oracleSnapshot` JSON column (camelCased: `{ mean, std, ciLow, ciHigh, articlesUsed, sources: [...] }`, all top-level values 0–100 percent — uniform across historical rows since the 2026-07-08 normalization). Persistence — from this path and every other estimate writer (news-indexer push, backfill, requote clock, creation) — goes through the single `recordEstimate` funnel in `src/lib/services/context.ts`, which stamps `origin`/`articlesUsed` on the snapshot and keeps `Prediction.confidence`/`aiCiLow`/`aiCiHigh` consistent (see [docs/DATABASE.md](./DATABASE.md)). The forecast detail page consumes this snapshot to render a translucent 95% CI band on the speedometer around the AI tick, inline CI text in the "AI estimate" block (e.g. `64% (95% CI: 52–76%)`), and an "Oracle sources" sub-section that chips each source with a credibility-weight dot (green ≥ 0.75, amber 0.4–0.75, grey < 0.4) and a `YES` / `NO` / `—` stance badge. LLM-fallback snapshots have `oracleSnapshot = null` and the UI gracefully hides the Oracle-only affordances.

### Fallback chain for forecast "AI %"

1.  **Oracul** (`POST /forecast`) — calibrated multi-source estimate. The client budget is
    per path, not global (`src/lib/services/oracle.ts`): **40 s** (`FORECAST_TIMEOUT_MS`) by default for
    server-to-server/background callers (news-indexer push, the retry sweep), **20 s** for
    bot voting, **12 s** (`INTERACTIVE_FORECAST_TIMEOUT_MS`) for the two interactive callers,
    which race the Oracul against their own wall clock and fall back to the LLM.
    Every budget must stay strictly above the server budget it waits on: retro does not
    cancel on client disconnect, so aborting early discards a forecast already paid for and
    records it as a failure. The original 30 s was derived from retro's own server-side latency (p99 25.0 s,
    clamped by its `per_article_timeout_seconds = 25`), not from its nominal
    `forecast_timeout_seconds = 90`, which had fired once in 93 days (daatan#1254). retro#760 raised
    that clamp to 35 s, so the same margin gives 40 s (#1709). news-indexer's push client
    (`PUSH_TIMEOUT_SECONDS`, 45 s) wraps this route, so don't raise it past ~40 s without raising that too.
2.  **LLM `guessChances`** (Gemini → Oracul → OpenRouter → Ollama via the provider chain above) — used if the forecast Oracul path is not configured, times out, returns a placeholder response, or has zero usable articles.

### Call sites

*   `POST /api/forecasts/[id]/context` — step 3 "AI probability" in the context analysis route.
*   `POST /api/forecasts/express/guess` — the express forecast guess endpoint.

In both routes, Oracul is tried first; if it returns `null`, the existing `guessChances` path runs unchanged.

### Configuration

| Env var | Required? | Notes |
|---------|-----------|-------|
| `ORACLE_URL` | Optional | Defaults to unconfigured (falls back to LLM). Set to `https://oracle.daatan.com` to enable. |
| `ORACLE_API_KEY` | Optional | Must match the `ORACLE_API_KEY` set in `oracle-api.service` on the retro EC2 instance. `getOracleApiKey()` (`src/lib/services/oracleClient.ts`) reads the shared SSM SecureString `/daatan/shared/secrets/ORACLE_API_KEY` first — one parameter, read by both retro and daatan, so the two sides can't drift (docs#122 group 3) — falling back to this env var for local dev / self-host. |

`ORACLE_URL` is validated in `src/env.ts` and delivered to production/staging via the `daatan-env-prod` / `daatan-env-staging` AWS Secrets Manager bundles, which are pulled to `~/app/.env` on each deploy by `scripts/fetch-secrets.sh`. `ORACLE_API_KEY` is validated the same way but is no longer the primary source in SaaS — see above.

# AI Panel — multi-model forecast estimates

**Status:** PR 1 (backend) implemented. No UI yet — the panel ships dark and accrues
data. Chart + preference toggle is PR 2; Brier scoring + leaderboard is PR 3.

A panel of independent LLMs, each producing a probability for every open forecast. The
panel is a **source shown on charts**, never an input to the needle, the gauge, or any
user-facing score. Members are scored against resolutions so we can eventually answer:
*do LLM forecasters beat the Oracle, the crowd, or each other?*

---

## 1. What this is not

The panel does **not**:

- write `Prediction.confidence`, `aiCiLow`, or `aiCiHigh`;
- go through `recordEstimate()` (`src/lib/services/context.ts`);
- appear on the `Speedometer` gauge;
- affect ELO, Glicko-2, RS, or any leaderboard.

These exclusions are **structural, not conditional**. `Speedometer` reads only
`aiCiLow`/`aiCiHigh` and the community probability — all columns on `Prediction`, all
written exclusively by `recordEstimate`. Because the panel owns separate tables and
never calls that funnel, no feature flag or code path can leak it into the gauge, the
high-confidence Telegram alert, or `awaitingAiResolution`.

This matters concretely: an ungrounded model will happily emit `97` on a claim with
zero supporting evidence. Routed through `recordEstimate`, that would trip
`awaitingAiResolution` (latches at `>=90` / `<=10`) and fire
`notifyIfCrossedHighConfidence`. The panel must never be able to do this.

---

## 2. Beta scope

| Dimension | Beta | Deferred |
|---|---|---|
| Mode | ungrounded only | vendor-native web search |
| Outcome types | `BINARY` only | `MULTIPLE_CHOICE`, `NUMERIC_THRESHOLD` |
| Pooling | none — chart members individually | log-odds pooling + extremization |
| Members | 4 + 1 control | more, driven by Brier |

Grounded mode is deferred on cost: web search bills **per request** (~$0.005/search on
OpenRouter; Google's grounding is ~6× that), which is 30–300× a token-only call. At
N=300 open forecasts that is ~$180/mo versus ~$6/mo ungrounded. Revisit once
per-member Brier shows whether the ungrounded priors are worth anything at all.

---

## 3. The prompt

Claim + dates + resolution rules. **No article text.** Lives as the `panel-estimate`
Bedrock prompt (`src/lib/llm/bedrock-prompts.ts`), with a hardcoded fallback.

Deliberately **not** `guess-chances`: that prompt is context-fed (`{{articlesText}}`)
and live on `/api/forecasts/express/guess`, so tuning the panel through it would
silently perturb forecast creation.

- `resolutionRules` is nullable on `Prediction`; it renders as `(none specified)`.
- `null` probability → `AiEstimate.insufficientData`, mirroring
  `ContextSnapshot.insufficientData`.
- All members support `structured_outputs`, so the JSON schema is enforced natively
  rather than steered by a system message (contrast `OracleProvider`).
- Responses are still validated after parsing: a provider that silently ignored
  `response_format` would otherwise poison the series with a plausible number.

### Known weakness

A bare "give me a number" invites round-number anchoring and acquiescence bias
(*"will X happen?"* scores higher than *"will X fail to happen?"* for the same X).
Mitigation, deferred to v2: ask each member the claim **and its negation** and record
`p + p̄`. Deviation from 100 is a per-member coherence score for one extra call.

---

## 4. Trigger: date-hash gating

The only input that changes over a forecast's life is the date. **No article text
reaches the model, so "new source arrived" cannot move the output** — a source-arrival
trigger would pay to resample a constant at `temperature: 0`.

`AiEstimateRun.inputHash` = sha256 of claim + rules + resolveBy + **UTC day** +
promptVersion + roster signature. If the latest run's hash matches, the sweep skips
the forecast entirely. In practice: one call per member per forecast per day.

The hash is at the **run** level, not per member — the date changes for every member at
once, so a run is atomic (all members or none). A unique index on
`(predictionId, inputHash)` makes the cron idempotent under concurrency.

The roster signature is folded in so adding or dropping a member forces a fresh sweep,
rather than producing runs with different member sets under one hash.

`temperature: 0` throughout. Combined with the date gate, an unchanged input yields an
unchanged number — so the chart's step-function carry-forward (which
`ProbabilityChart` already does for the `ai` series) is exactly right rather than an
approximation of resampling noise.

### Why the cron runs twice a day for a once-a-day answer

The second tick is a free no-op — no LLM calls, no writes — whenever the first
succeeded, because the hash is unchanged. It exists purely so a failed tick self-heals
within 12h instead of 24h.

### A useful side effect

A date-only ungrounded estimate *is* a glide: the model's implicit hazard rate as the
deadline approaches. We already compute a glide arithmetically in `requote.yml`
(zero-parameter constant hazard, `origin: 'clock'`). The panel therefore gives us a
**learned** glide to compare against the arithmetic one, and matched-time Brier will
say which is better. This comparison is free.

---

## 5. Roster

`src/lib/llm/panel/roster.ts`. Four on OpenRouter, one on Bedrock.

| Member | Route | Lineage | Role |
|---|---|---|---|
| `qwen.qwen3-235b-a22b-2507-v1:0` | **bedrock** | Alibaba | deterministic baseline, outage-proof |
| `deepseek/deepseek-chat` | openrouter (`deepinfra/fp4`) | DeepSeek | |
| `google/gemini-2.5-flash` | openrouter (`google-vertex/eu`) | Google | |
| `x-ai/grok-4.3` | openrouter (`xai`) | xAI | |
| `google/gemma-3-4b-it` | openrouter (`deepinfra/bf16`) | Google (4B) | **control** |

> **No OpenAI member.** The gpt-5 lineup on OpenRouter is *reasoning-mandatory* —
> `reasoning: {enabled: false}` returns `HTTP 400 "Reasoning is mandatory for this
> endpoint and cannot be disabled"`, so `gpt-5-mini`/`gpt-5-nano` abstained on 100% of
> calls (confirmed 2026-07-11: all 56 staging rows null). Reasoning models are
> incompatible with this panel by construction — temperature 0, no hidden thinking, one
> cheap integer, a deterministic step-function chart. DeepSeek replaces the OpenAI slot
> as a genuinely independent lineage; a 4B Gemma is a cleaner control than a mini
> frontier model. Every member verified against the live API (`finish=stop`, ~7–8
> completion tokens) before landing. Revisit if OpenAI ships a non-reasoning tier.
>
> **Grok honors `reasoning: {enabled: false}`** (5–6 tokens observed), so the
> `max_tokens: 64` cap never trips on it — the concern that drove that cap is resolved.

The Bedrock member is not about the $0.23/mo it saves. Every member used to depend on
one third-party credential, and on 2026-07-10 that credential was dead: all 285 calls in
the panel's first real sweep returned 401 and nothing was produced. A member on the
app's own IAM role keeps the panel producing estimates through an OpenRouter outage or a
stale key. Its Bedrock model id differs from the OpenRouter slug, so Brier treats it as a
distinct member — correct, since the weights are the same but the quantization may not be.

The **control member** is a falsification check: if a deliberately weak model scores
the same Brier as Grok, the instrument is not measuring anything and a flat
leaderboard is uninterpretable. ~$0.20/mo.

`AiEstimate.model` and `.mode` are plain `String`, never enums — adding a member is one
array entry and no migration.

### Cost

At ~250 input / ~30 output tokens, one call per member per day. Staging reports
**N = 57** open BINARY forecasts (measured 2026-07-09 via a `?dryRun=1` sweep), i.e.
57 × 5 members × 30 days = 8,550 calls/month:

| Scenario | N=57 (measured) | N=300 (hypothetical) |
|---|---|---|
| Reasoning off | **~$1.20/mo** | ~$6/mo |
| Reasoning on (~800 hidden tokens) | ~$11/mo | ~$57/mo |

We send `reasoning: { enabled: false }` and cap `max_tokens` at 64. Gemini prices
`internal_reasoning` at the output rate, so a model that ignores the flag would cost
~9×; the cap turns that into a failed call (→ abstention) rather than a silent bill.
Hidden CoT is also unstored, so it could not explain why a member's line moved, and it
breaks determinism at `temperature: 0`.

### Gotchas

- **`provider.order` is pinned, `allow_fallbacks: false`.** OpenRouter routes one slug
  to different backends with different quantizations (`qwen3-235b` is fp8 on every
  provider, but which fp8 varies). Unpinned, run-to-run variance gets misattributed to
  the model and corrupts the per-member Brier comparison. Tags verified against
  `https://openrouter.ai/api/v1/models/{slug}/endpoints`.
- **The panel never uses `ResilientLLMService`.** That is a *failover* wrapper: it
  would write an `AiEstimate` row labelled `google/gemini-2.5-flash` containing Llama's
  output. `src/lib/llm/panel/client.ts` calls OpenRouter directly, and a failure is
  recorded as an **abstention**, never as a substitution.
- **Dormant only when nothing can authenticate.** A missing OpenRouter key no longer
  stops the panel: the Bedrock member runs on the app's IAM role, so the sweep proceeds
  with that member alone. `{dormant: true}` (a 200, not a failure) now requires *both*
  no OpenRouter key *and* no non-OpenRouter member. See `isDormant()`.

### AWS credits: not about cost — about not having a single point of failure

Of the five, only `qwen3-235b-a22b-2507` exists on Bedrock
(`qwen.qwen3-235b-a22b-2507-v1:0`, eu-central-1). Bedrock carries OpenAI's and Google's
*open-weights* lines (`gpt-oss-*`, `gemma-3-*`), not their flagship API models; xAI is
absent entirely. Substituting open-weights cousins under the same member label would
poison the per-member comparison, so the other four stay on OpenRouter.

Running Qwen on Bedrock saves $0.23/mo, which is nothing. The reason to do it is that
**every member currently depends on one third-party credential** — and on 2026-07-10
that credential was dead, so all 285 calls in the first real sweep returned 401 and the
panel produced nothing. A Bedrock member runs on the account's own IAM role and keeps
the panel producing data through an OpenRouter outage or a bad key. It is also the only
non-reasoning member, so it carries none of the hidden-token cost risk.

`terraform/bedrock_invoke.tf` grants the app role `bedrock:InvokeModel`, scoped to the
model ids the roster names. `AiEstimate.model` records the Bedrock model id, so a member
that moves between routes is correctly treated as a *different* member for Brier.

---

## 6. Schema

`AiEstimateRun` + `AiEstimate`, modelled on `ExternalMarketPriceSnapshot` — the
existing precedent for an independent probability series that is charted but drives
nothing.

Member identity is `(model, mode, promptVersion)`. `promptVersion` is a fingerprint of
the prompt template (sha256, 12 chars) rather than a Bedrock version id, so it stays
correct when the hardcoded fallback prompt is in use. **Change the prompt and prior
Brier scores stop being comparable** — without this column the leaderboard would
silently average two different members.

`elections/prisma/schema.prisma` carries a six-model subset mirror; it needs these
tables too, or a rollup to read. (Not required until PR 2 charts the panel there.)

---

## 7. Scoring: matched-time Brier

A human stakes **once**; the panel updates daily. Averaging Brier across all panel
estimates flatters the panel enormously — an estimate made the day before resolution
is nearly free. Published next to human scores, that comparison would be worthless.

Instead `Commitment.aiRunIdAtCommit` pins the run current at commit time, exactly as
`communityProbabilityAtCommit` already pins the crowd and feeds `peerScore` /
`aiScore` at `prediction-resolution.ts`.

**A run FK, not a scalar.** The existing `aiProbabilityAtCommit` is a scalar because
the Oracle *is* one number. The panel is many, and a scalar would collapse it at the
exact instant we capture it, destroying per-model Brier — the entire reason for running
several models. The FK keeps every member's probability recoverable, and lets a member
added in month six be backfilled and scored without migrating `commitments`.

Nulls handle themselves: commits placed before the first run drop out of aggregates
the same way `brierScore` already does (`profile.ts` filters
`{ brierScore: { not: null } }`).

### The sweep is deliberately not gated on commitments

An obvious cost saving is to only estimate forecasts someone has staked on. **Don't.**
Matched-time Brier snapshots the run current at commit time, so a forecast whose first
commit arrives before its first run yields a null `aiRunIdAtCommit` and is permanently
unscoreable. The runs must lead the commits. At ~$6/mo the gate buys nothing and costs
data.

### The Oracle is a free fifth member

The Oracle's estimates are already persisted as timestamped `ContextSnapshot` rows with
`externalProbability`. Scoring it as a panel member costs **zero extra calls** — read
the latest snapshot as of the commit instant. This answers whether TruthMachine beats
cheap LLMs with no search at all. (PR 3.)

---

## 8. UI (PR 2, not yet built)

`ProbabilityChart.tsx` already renders `community`, `ai` (the Oracle needle), and
`market`. The panel adds member lines.

- **Member lines, one per member. No pooled line.** Pooling is deferred — we do not
  yet know how to weight members, and per-member Brier is what will tell us. Chart what
  was measured, and nothing else.
- **Default off**, behind a user preference (`User.showAiPanel Boolean @default(false)`).
- **Dashed vs solid** carries the "does not move scores" distinction visually, without
  a legend disclaimer nobody reads.
- Expect member lines to render **nearly flat** between date changes. That is the prior
  doing its job, not a rendering bug.
- Same treatment in `elections/src/components/CombinedSourcesChart.tsx`.

---

## 9. Runner

`GET /api/cron/ai-panel`, triggered by `.github/workflows/ai-panel.yml` at 04:43 and
16:43 UTC (off the hour, off the requote cron at 05:31).

- Selects `status = ACTIVE`, `outcomeType = BINARY`, deadline not passed.
- Per forecast: compute hash → skip, or call all members concurrently → write one run.
- A failed member call is an **abstention**. If *every* member's call throws, nothing is
  written — otherwise the date gate would suppress retries until tomorrow, turning a bad
  API key into a silent 24h outage. (A run where members deliberately returned `null`
  *is* written: that is real signal.)
- One bad forecast never aborts the sweep.
- **A rejected OpenRouter key (401/403) disables those members for the rest of the
  sweep.** Auth failure is a property of the *shared key*, not of the member: if one
  OpenRouter member 401s they all will, so retrying is guaranteed to fail.
  `PanelAuthError` latches on the first rejection, so a dead key costs one rejected
  request per sweep, not one per member per forecast.

  It is **scoped to the OpenRouter route.** Bedrock members authenticate with the app's
  IAM role and keep producing — that is the entire reason one exists. Conversely a
  Bedrock `AccessDeniedException` (e.g. `terraform/bedrock_invoke.tf` not yet applied)
  is a plain per-member abstention and must never disable the OpenRouter members.

  Members we cannot authenticate are **not asked, and not recorded as abstentions**: an
  abstention means "the model saw the claim and declined", so writing one for a member
  we never consulted would be a lie in the data.

  The route still answers **502** whenever the key was rejected — even if Bedrock
  members carried the sweep. A dead credential is an incident to fix, not a state to
  tolerate, and `ai-panel.yml` must go red.

  This is the failure that actually happened on staging 2026-07-10: a dead key produced
  57 × 5 = 285 identical `401 "User not found."` warnings, and the cron still answered
  `200 {"ok":true,...,"failed":57}` — the workflow printed "✅ Panel sweep OK". A dead
  credential must not look like a healthy no-op.

  `dormant` (nothing can authenticate at all) stays a **200**: a deliberate state.
- Query params: `?dryRun=1` (build and log prompts, call nothing), `?limit=N`.
  A dry run reports `{written: 0, dryRun: N}` — **never** `written: N`. A dry run that
  claims writes is precisely the output that makes someone trust a dry run they
  shouldn't.
- Does **not** proxy through the Oracle's `/llm`: that endpoint is capped at
  `30/minute` and shares the budget with the user-facing LLM fallback chain.

---

## 10. Deferred

- Pooling (log-odds median + extremization factor `a`, fitted on ≥100 resolutions).
- Grounded mode (~$180/mo at N=300 via OpenRouter web search).
- Negation-coherence check (`p + p̄ ≈ 100`).
- `MULTIPLE_CHOICE` / `NUMERIC_THRESHOLD` outcome types.
- Public AI-vs-humans leaderboard.

## 11. Open questions

- **N = 57 on staging** (measured 2026-07-09). Prod is unmeasured; confirm with
  `SELECT count(*) FROM predictions WHERE status='ACTIVE' AND "outcomeType"='BINARY';`
- Can `reasoning` actually be disabled on `x-ai/grok-4.3`? Measure `completion_tokens`
  on the first real sweep — `max_tokens: 64` bounds the damage either way.
- OpenRouter prices verified live 2026-07-09. They move.
- **CI does not run integration tests.** `deploy.yml` runs `npm test`, which excludes
  `**/*.integration.test.ts`. The FK is covered by unit tests there; the integration
  test covering the real FK/migration must be run locally with `npm run test:integration`.

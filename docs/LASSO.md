# LASSO — LLM AS SOurce

**Status:** live in production since v1.50.0 (2026-07-11). Estimate → chart → score →
rank, all shipped. Pooling and the Oracle-integration are the open extensions (§10).

> Internally the code still calls this the "AI panel" (`ai_estimates`, `ai-panel.ts`,
> `PANEL_MEMBERS`, `/api/cron/ai-panel`). **LASSO is the project name; "AI panel" is the
> subsystem.** A code-identifier rename is deliberately deferred — it would churn DB
> tables and every call site for no behavioural gain. This doc is the source of truth for
> what the thing *is*.

## What LASSO is (and is not)

Several independent LLMs each estimate a probability for every open forecast. **The name
is the thesis: each LLM is treated AS a candidate SOurce of forecasting signal** — sitting
alongside daatan's other sources (the crowd, linked markets, the Oracle) — and then
*measured* on how good a source it actually is.

The pun is deliberate: statistical **LASSO regression** does feature *selection* — keeping
the predictors that carry signal and shrinking the rest to zero. LASSO-the-system does the
same to models: score each one against real outcomes and learn which to trust, per topic.

Two things it is **not**:

- **Not the Oracle.** The Oracle (TruthMachine) is *one grounded verdict* — it searches,
  weighs evidence by source credibility, and emits a single reasoned probability. LASSO is
  *many unaided priors*, compared. The Oracle is scored inside LASSO as just another
  member (`'oracle'`), so the board answers "does the grounded Oracle beat the raw LLMs?".
- **Not (yet) a source for anything.** An LLM here is a **candidate being measured**, not a
  deployed input. Nothing consumes LASSO's output as a forecasting signal today — not the
  Oracle, not the needle, not any score. It only *earns a track record*. Wiring a proven
  model back in (as the Oracle's prior, say) is a future extension (§10), not the current
  reality.

So LASSO never moves the needle, the gauge, or any user-facing score. It produces
estimates, charts them as an opt-in source, scores them at resolution, and ranks them —
to answer: *do LLM forecasters beat the Oracle, the crowd, or each other, and which one
where?*

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

A *partial* run — e.g. the OpenRouter key 401s and only the Bedrock member answers —
carries the day's hash but not the full roster (unauthenticated members are never asked,
so no row exists for them). Since v1.53.0 a later same-day sweep **completes it in
place**: only the missing-and-now-askable members are called, and their estimates are
appended to the day's run. This is sound because the estimate is deterministic for the
day — temperature 0 and a date-only prompt mean the appended number is exactly what it
would have been at the run's original instant, the same premise the chart's
step-function carry-forward rests on. Recorded members (including failure-abstentions)
are never re-asked: one call per member per forecast per day stands.

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
tables too, or a rollup to read. (Not required until the elections mirror charts the
panel — still open, see §10.)

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

The Oracle's needle at commit time is already pinned on the commitment as
`aiProbabilityAtCommit`, so scoring it as a panel member (`model: 'oracle'`) costs
**zero extra calls and zero extra columns**. This answers whether TruthMachine beats
cheap LLMs with no search at all. (Shipped in v1.49.0; the linked market joined as a
second sentinel member, `'market'`, in v1.51.0.)

---

## 8. UI (shipped in v1.48.0)

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
- Same treatment planned for `elections/src/components/CombinedSourcesChart.tsx`
  (still open, §10). Known gap: the localized forecast routes (`/he/…`, `/ru/…`)
  don't load the panel series yet — opted-in users see the lines only on the
  canonical route.

---

## 9. Runner

`GET /api/cron/ai-panel`, triggered by `.github/workflows/ai-panel.yml` at 04:43 and
16:43 UTC (off the hour, off the requote cron at 05:31).

- Selects `status = ACTIVE`, `outcomeType = BINARY`, deadline not passed.
- Per forecast: compute hash → skip, or call all members concurrently → write one run.
- **A matching hash with a partial member set triggers a completion pass** (§4): only the
  missing-and-askable members are called and their estimates appended to the day's run
  (`completed-partial` in the summary). If none of the missing members can be asked, the
  forecast stays `skipped`; if all completion calls throw, nothing is appended and the
  next tick retries.
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

## 10. Extensions

Shipped: estimate (5-member roster), date-hash-gated cron, opt-in chart, matched-time
Brier, AI-vs-humans leaderboard (`/leaderboard/ai`).

Open, roughly in order of value:

- **Graduate a source (the "AS SOurce" payoff).** Today an LLM is only *measured*. Once
  the leaderboard shows a model reliably beating the crowd on a topic, wire it back in as
  an actual input — most naturally as the **Oracle's ungrounded prior before it searches**,
  or its per-topic best model. This is the reverse of today's wiring (LASSO contains the
  Oracle; here the Oracle would consume LASSO) and it lives in `retro/`, not daatan. It is
  the reason the name is "as SOurce" and not "vs humans" — see the cross-repo note in
  `Daatan/docs/lasso.md`.
- **Pooling** — one blended LASSO line from the members (log-odds median + a fitted
  extremization factor `a`). Deferred until ≥~100 resolutions exist to fit `a` against;
  premature before then, and a plain mean collapses toward 50.
- **Grounded mode** — members with vendor web search (~$180/mo at N=300). Worth revisiting
  once per-member Brier shows whether the ungrounded priors are worth anything.
- **Negation-coherence check** — ask each member the claim *and* its negation, record
  `p + p̄`; deviation from 100 is a per-member calibration signal for one extra call.
- `MULTIPLE_CHOICE` / `NUMERIC_THRESHOLD` outcome types (today: `BINARY` only).
- **Elections mirror** — `elections/` needs the `ai_estimate*` tables (a subset mirror) to
  chart LASSO there too.

## 11. Notes & gotchas

- **Migration files keep the old `AI_PANEL.md` path** in their comments
  (`20260715…_ai_panel`, `…_user_show_ai_panel`, `…_ai_member_score`). They are
  checksummed and immutable — editing an applied migration triggers Prisma drift — so the
  historical reference stays. This doc is the live source of truth.
- **Grok honors `reasoning: {enabled: false}`** — confirmed on the first real sweep (5–6
  completion tokens, not ~800), so the `max_tokens: 64` cap never trips on it. The
  question that drove that cap is closed.
- **OpenAI is excluded.** The gpt-5 lineup on OpenRouter is reasoning-mandatory
  (`reasoning: {enabled:false}` → HTTP 400), incompatible with the panel's design; DeepSeek
  and a 4B Gemma control replaced the two OpenAI slots (2026-07-11).
- **CI does not run integration tests.** `deploy.yml` runs `npm test`, which excludes
  `**/*.integration.test.ts`; the matched-time FK is covered by unit tests there, and the
  integration test must be run locally with `npm run test:integration`.
- **Partial runs are completed in place** (since v1.53.0 — see §4). A sweep that finds
  the day's run missing roster members appends their estimates once they can be asked
  (`completed-partial` in the sweep summary), so a fixed key fills the same day's hole
  and commitments pinning the partial run become scoreable for the filled members.
  Members that still can't be authenticated keep the forecast quietly `skipped` — a
  deliberate Bedrock-only (no-key) deployment does not report failures. Historical note:
  staging's 1-member run from the 2026-07-10 incident predates the fix and stays
  incomplete (its day has passed).
- **Failed call vs deliberate abstention is implicit in the data.** Both store
  `probability: null, insufficientData: true`; they differ only in that a failed call has
  null `latencyMs`/token counts. Day-one staging data shows the distinction is real:
  DeepSeek's 19 nulls were all transport failures (pinned single provider), Grok's 23
  were genuine "too vague" declines.
- **`ai_member_scores` stores `promptVersion`** (since v1.52.0; null for the
  `'oracle'`/`'market'` sentinels) and the leaderboard groups by
  `(model, promptVersion)`, so a prompt change forks a member's board row instead of
  silently averaging two incomparable series — closing the gap §6 warns about. Rows
  are labelled with a fingerprint suffix only when a model actually spans versions.
- OpenRouter prices were verified live 2026-07-09/11; they move.

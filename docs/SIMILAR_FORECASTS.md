# Similar-Forecasts Matching — Design

> Status: **proposal / design** (2026-06-24). Captures the redesign of how we decide
> two forecasts are "similar" (for the related-panel) or "the same" (for create-time
> dedup). The current implementation is documented in [`EMBEDDINGS.md`](./EMBEDDINGS.md);
> this doc is the plan to evolve it.

## Where it lives today

- Embedding: [`src/lib/services/embedding.ts`](../src/lib/services/embedding.ts) — Gemini `gemini-embedding-2`, 768-d.
- Matching: `findSimilarForecasts()` in [`src/lib/services/forecast.ts`](../src/lib/services/forecast.ts).
- API: [`src/app/api/forecasts/similar/route.ts`](../src/app/api/forecasts/similar/route.ts).
- Consumers: the **SimilarForecasts** detail panel (discovery) and the **express-create** flow (dedup/suggest).
- Index: HNSW (`vector_cosine_ops`) on `predictions.embedding`.

## Current algorithm (baseline)

Single-vector dense retrieval:

1. Embed **only `claimText`** (raw, no normalization).
2. SQL: `score = 1 - (embedding <=> q)`, filter `status IN ('ACTIVE','PENDING_APPROVAL')`, `HAVING score ≥ 0.75`, order by distance, fetch `5×limit`.
3. App re-rank: sort by score, then shared-tag count **as a pure tiebreak**; take top N.

Same path, same `0.75` threshold, serves both discovery and dedup.

## Problems with the baseline

1. **The date is embedded as text.** `claimText` carries the timeframe ("within 90 days", "by 2026"), so it lands in the vector — and the authoritative `resolveByDatetime` is **only SELECTed for display**, never used in scoring. Embedding the date as tokens fails in two opposite directions:
   - **Too weak to separate:** "…by 2026" vs "…by 2027" is a one-token diff → cosine barely moves → genuinely different claims look identical.
   - **Too noisy to match — and broken on relative dates:** different phrasings of the same window ("within 90 days" / "by end of Q3" / "by Sep 30") tokenize differently and push vectors apart. Worst case: **two "within 90 days" forecasts created six months apart have identical text → identical embedding, but deadlines six months apart.** The vector says "duplicate"; the only field that knows otherwise (`resolveByDatetime`) is unused.
2. **Tags are a tiebreak, not a signal.** A `0.76` match sharing zero tags outranks a `0.755` match sharing every tag. Category is ignored entirely.
3. **One threshold for two jobs.** Discovery wants recall + diversity; create-time dedup wants precision ("is this the *same* claim?"). `0.75` flat is wrong for both.
4. **The HNSW index is likely defeated.** The query `LEFT JOIN`s tags and `GROUP BY p.embedding` *before* `ORDER BY … LIMIT`, so the planner can't do a clean top-K index scan through the aggregation.
5. **(Future) dense-only misses entities** — tickers, person names, bill numbers — where embeddings smear. Out of scope for v1; see Future work.

## Goals / non-goals

**Goals (v1)**
- Handle the deadline as a **structured feature**, not embedded text.
- Fold tags/category into the **score**, not just a tiebreak.
- Separate **discovery ranking** from **dedup gating**.
- Keep the ANN index effective (two-stage retrieve → re-rank).

**Non-goals (deferred)**
- Hybrid lexical/BM25 fusion (RRF).
- Cross-lingual matching (he/ru/eo ↔ English twins).
- Learned weights / a trained reranker.

## Design

### Features (per candidate C vs query Q)

```
event_sim = cosine( embed(norm(claim_Q)), embed(norm(claim_C)) )   # ~[0,1]
            # norm() strips the temporal phrase so the vector is about the
            # EVENT, not the date wording.

tag_sim   = |tags_Q ∩ tags_C| / |tags_Q ∪ tags_C|                  # Jaccard ∈ [0,1]

horizon   = max( resolveByDatetime_Q − createdAt_Q , 7d )          # the forecast's own window
Δ_dead    = | resolveByDatetime_Q − resolveByDatetime_C |  (days)  # STRUCTURED, not text
dl_sim    = exp( − Δ_dead / (τ · horizon) )                        # ∈ (0,1], τ ≈ 0.25
```

`dl_sim`'s tolerance **scales with the horizon**: 11 days off matters for a 90-day forecast, but a year off is fine for a 5-year one. For numeric-threshold forecasts, add a symmetric `thr_sim` over the parsed numeric target (e.g. `$100k`, `60%`) using the same relative-distance decay.

### Discovery / ranking score (soft)

Deadline as a **multiplicative gate**, not an additive nudge — a far deadline should crush the score, not shave it:

```
score = ( w_s·event_sim + w_t·tag_sim ) · dl_sim          # · thr_sim if numeric
        # w_s ≈ 0.8, w_t ≈ 0.2
```

Keep `event_sim ≥ 0.75` as the cheap retrieval floor, rank by `score`, then apply **MMR** (maximal marginal relevance) over the top results so the related-panel isn't three rephrasings of one claim.

### Dedup gate (create path — precision)

A cascade of hard conditions; only survivors get the expensive confirm step:

```
is_dup_candidate(C) =
      event_sim ≥ T_dup                       # 0.85, higher than the 0.75 discovery floor
  AND Δ_dead   ≤ min(0.15·horizon, 45d)
  AND category_Q == category_C
  AND outcomeType_Q == outcomeType_C
  AND (numeric ? thr_sim ≥ 0.9 : true)

→ for the ≤5 survivors: a cheap LLM yes/no "same claim?"  → block / merge / suggest
```

### Why it works — same text, opposite verdict

> Q = "Anthropic announces a mandatory safety audit **within 90 days**", created Jun 1 → deadline **Aug 30** (horizon ≈ 90d).

| Candidate | claim text | `event_sim` | Δ_dead | `dl_sim` | verdict |
|---|---|---|---|---|---|
| **C1** created **Jan 1** | *identical string* | 1.00 | 151d | **0.001** | **not a dup** ✓ |
| **C2** deadline **Sep 10** | same event | 1.00 | 11d | 0.61 | dup → LLM confirm ✓ |

C1 is exactly what breaks the baseline: identical text → identical vector → "duplicate." The structured deadline gate rejects it; the vector never could.

### Retrieval shape (two-stage — also fixes the HNSW footgun)

```sql
-- Stage 1: pure ANN top-K, NO joins → a real HNSW index scan
SELECT id, (embedding <=> $q) AS dist
FROM predictions
WHERE status IN ('ACTIVE','PENDING_APPROVAL') AND embedding IS NOT NULL AND id <> $self
ORDER BY embedding <=> $q
LIMIT 50;
```

```
// Stage 2 (app): for those ≤50 ids, fetch tags + resolveByDatetime + category +
// threshold, compute event_sim/tag_sim/dl_sim/thr_sim, then:
//   discovery → combine + MMR + take N
//   dedup     → run the hard gate + LLM confirm
```

The deadline gate lives **app-side in Stage 2** (decision below): easier to tune, and Stage 1 stays a clean ANN scan.

## Decisions (the two forks)

1. **`norm()` = deterministic temporal-phrase stripping** at embed time (regex/date-expression patterns: "within N days/weeks/months", "by <date>", "before <date>", "in YYYY", "by end of Q[1-4]", …). Cheap, no extra API call. The deadline is *already* parsed into `resolveByDatetime` at creation, so we lose nothing by removing the phrase from the text. **LLM canonicalization of the event sentence is deferred** (cleaner, but adds a create-time call).
2. **Deadline gate is app-side (Stage 2)**, not in SQL. `dl_sim`/`thr_sim`/tags re-rank 50 rows in memory; the SQL stays a clean ANN top-K.

## Parameters & calibration

| Param | Start | Meaning |
|---|---|---|
| `T_retrieve` | 0.75 | Stage-1 cosine floor (keep) |
| `T_dup` | 0.85 | dedup `event_sim` floor |
| `w_s` / `w_t` | 0.8 / 0.2 | event vs tag weight |
| `τ` | 0.25 | deadline tolerance as a fraction of horizon |
| `D_max` | `min(0.15·horizon, 45d)` | dedup deadline gate |
| `thr_dup` | 0.9 | numeric-threshold gate |
| `K` | 50 | Stage-1 fan-out |

These are educated guesses. Pin them against a labeled set of **duplicate / not-duplicate / related** triples — ~100 hand-labeled pairs is enough to fix `T_dup`, `τ`, and the weights. Log create-time dedup decisions (and any user override) to grow that set.

## Rollout

Each phase is shippable on its own, behind the existing `findSimilarForecasts()` surface:

1. **Stage-1/Stage-2 refactor** — ANN top-K subquery, then app re-rank. No behavior change; fixes the index footgun.
2. **Deadline + tags into the score** — add `dl_sim` (from `resolveByDatetime`) and weighted `tag_sim`. Discovery-only; dedup still uses the old floor.
3. **`norm()` + re-embed** — strip temporal phrases at embed time; backfill via the existing [admin backfill-embeddings](./EMBEDDINGS.md#backfill) endpoint.
4. **Dedup path** — high `T_dup` + hard gate + category/outcome match + optional LLM confirm in the express-create flow.
5. **(Future)** hybrid lexical (RRF), cross-lingual, learned weights/reranker.

## Risks / open questions

- **Re-embedding cost** when `norm()` changes the embedded text — bounded; reuse the existing backfill path, run paced.
- **`norm()` over-stripping** — a duration that's *part of the event* ("90-day ceasefire") must not be removed as if it were a deadline. Strip only leading/trailing deadline phrases, not in-claim durations; unit-test the patterns.
- **`thr_sim` parsing** reliability for numeric forecasts (units, ranges, "%") — start conservative; fall back to "no threshold feature" when parsing is unsure.
- **Calibration data** — needs a labeled set; bootstrap from logged dedup decisions.

## See also

- [`EMBEDDINGS.md`](./EMBEDDINGS.md) — current embedding stack, schema, backfill, failure modes.
- `findSimilarForecasts()` — [`src/lib/services/forecast.ts`](../src/lib/services/forecast.ts).

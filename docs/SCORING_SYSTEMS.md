# Scoring Systems — Architecture & Reference

## Overview

DAATAN computes multiple scoring systems for ranking predictors. Each system measures a different aspect of forecasting skill. Systems are tag-filterable — the leaderboard can rank users within a specific topic using the `?tag=` parameter.

**What the UI shows (since 2026-09-23):** ELO is the headline rating. The leaderboard page offers three sort tabs — ELO (default), Accuracy, Brier Score — and always shows those three columns; the profile header card is ELO and the profile scores grid is Accuracy + Brier + the calibration chart. Every other system below is still computed and reachable through `GET /api/leaderboard?sortBy=` but is not rendered anywhere user-facing. The `N RS` chips (sidebar, forecast author line, activity feed, profile OG image) were replaced by ELO at the same time.

The scoring architecture is defined in `src/lib/services/scoring-systems.ts`. Adding a new scoring system requires only:
1. Adding its key to `SortBy`
2. Adding its aggregated data field to `ScoringContext` (plus one DB query in `leaderboard.ts`)
3. Adding a `ScoringSystem` descriptor to `SCORING_SYSTEMS`

No changes to the sort loop or leaderboard entry construction are required.

---

## Scoring Systems

### Reputation Score (RS)

**Key:** `rs` · **Sort:** higher is better

The original DAATAN score. Earned by making correct forecasts weighted by confidence (CU committed). Wrong calls reduce RS proportionally. Global field on `User.rs` — not tag-filterable.

**Formula:** RS change = f(confidence, outcome, pool) — computed at resolution.

---

### Accuracy

**Key:** `accuracy` · **Sort:** higher is better

Percentage of resolved commitments where `rsChange > 0` (i.e. the commitment was "correct" enough to gain RS). Tag-filtered.

**Formula:** `correct_count / resolved_count × 100`

---

### Most Correct

**Key:** `totalCorrect` · **Sort:** higher is better

Raw count of correct resolved commitments in the selected tag scope.

---

### CU Committed

**Key:** `cuCommitted` · **Sort:** higher is better

Total Confidence Units staked in the selected tag scope. Measures conviction and participation volume.

---

### Brier Score

**Key:** `brierScore` · **Sort:** lower is better

Calibration measure: `(predicted_probability − actual_outcome)²`. Perfect score = 0. Tag-filtered average across all resolved commitments.

Ranges:
- Binary: `p = (confidence + 100) / 200`, outcome ∈ {0, 1}
- Multiple-choice: `p = confidence / 100`

---

### ELO Rating

**Key:** `elo` · **Sort:** higher is better · **Per-tag:** yes (materialized)

Head-to-head competitive rating. When two users commit to the same prediction, the more accurate one (lower Brier score) gains ELO from the other.

**Global:** stored incrementally on `User.eloRating`, updated at each resolution.  
**Per-tag:** stored in `UserTagRating.elo` — one row per `(userId, tagId)`. Updated incrementally inside the resolution transaction via `updateTagRatingsInTx` in `src/lib/services/tag-ratings.ts`. Seeded lazily on the first leaderboard request for a tag via `ensureTagRatingsSeeded` (which calls `replayEloHistory(tagSlug)` once and writes the results). All users start at 1500 within each tag scope.

**Per-tag with no row:** a user with no `UserTagRating` row for the selected tag never resolved a forecast in it, so the tag leaderboard returns `eloRating: null` for them (sorted last, rendered `—`) rather than falling back to their global value — otherwise the board would not change with the tag for those users. The profile does the same (`ProfileScores.elo === null`).

**Update formula:** K=32 pairwise:
```
expected_A = 1 / (1 + 10^((elo_B - elo_A) / 400))
delta_A = K × (actual_A - expected_A)
actual_A = brierScore_A < brierScore_B ? 1 : brierScore_A > brierScore_B ? 0 : 0.5
```

---

### Glicko-2 Rating

**Key:** `glicko` · **Sort:** higher is better · **Per-tag:** yes (materialized)

Uncertainty-aware skill rating. The leaderboard rank uses `μ − 3σ` (lower bound of skill), which prevents one-hit wonders from topping the board — a user with one correct prediction has high σ and thus a low floor.

**Global:** stored incrementally on `User.mu`, `User.sigma`, `User.volatility`, updated at each resolution.  
**Per-tag:** stored in `UserTagRating.mu`, `.sigma`, `.volatility` — one row per `(userId, tagId)`. Updated incrementally inside the resolution transaction via `updateTagRatingsInTx`. Seeded lazily on the first leaderboard request for a tag via `ensureTagRatingsSeeded` (which calls `replayGlicko2History(tagSlug)` once and writes the results). All users start at defaults (μ=1500, σ=350, volatility=0.06) within each tag scope.

**Rank formula:** `μ − 3σ`  
**Outcome signal:** `score = 1 − brierScore` (0=worst, 1=perfect)  
**Reference opponent:** social consensus baseline at μ=1500, σ=350  
**Constants:** SCALE=173.7178, TAU=0.5, ε=1e-6  
**Minimum (per-tag only):** requires ≥3 resolved predictions in the selected tag; users below this threshold return `null` and sort last — same as `roi` and `truthScore`.

Reference: [Glickman (2012)](http://www.glicko.net/glicko/glicko2.pdf)

---

### Peer Score

**Key:** `peerScore` · **Sort:** higher is better · **Tag-filtered:** yes

Measures how much better your probability estimates are compared to the community consensus at commit time.

**Formula per commitment:** `(community_probability − outcome)² − (user_probability − outcome)²`  
Positive = you beat the crowd; negative = the crowd was more accurate than you.  
Stored on `Commitment.peerScore` at resolution.

**Leaderboard value:** sum of all peer scores in the selected tag scope.

---

### AI Score

**Key:** `aiScore` · **Sort:** higher is better · **Tag-filtered:** yes

Measures how much better your probability estimates are compared to the AI's estimate at commit time.

**Formula per commitment:** `(ai_probability − outcome)² − (user_probability − outcome)²`  
Positive = you beat the AI.  
Stored on `Commitment.aiScore` at resolution.

**Leaderboard value:** sum of all AI scores in the selected tag scope.

---

### TruthScore

**Key:** `truthScore` · **Sort:** higher is better · **Tag-filtered:** yes

Average peer score per prediction — how *consistently* you beat community consensus, normalised for prediction volume. Requires minimum 3 resolved predictions to avoid noise.

**Formula:** `peer_score_sum / peer_score_count` (min 3 predictions)  
Range: typically −0.25 to +0.25

---

### ROI

**Key:** `roi` · **Sort:** higher is better · **Tag-filtered:** yes

Average net RS change per resolved prediction. Positive = you earn RS on average; negative = you lose RS. Requires minimum 3 resolved predictions.

**Formula:** `sum(rsChange) / count(rsChange)` (min 3 predictions, all signs included)

---

### Weighted Peer Score *(Metaculus-style)*

**Key:** `weightedPeerScore` · **Sort:** higher is better · **Tag-filtered:** yes

Peer score with exponential time decay — recent predictions count more than older ones. Inspired by [Metaculus](https://www.metaculus.com) scoring.

**Formula:**
```
weightedPeerScore = Σ(peerScore_i × decay^(days_since_resolution / 30))
                   / Σ(decay^(days_since_resolution / 30))
```
Where `decay = 0.95` (approximately half-weight after ~14 months).

Requires minimum 3 resolved predictions. Computed at query time from `Commitment.peerScore` and `Prediction.resolvedAt`.

---

## Adding a New Scoring System

1. **Add the key** to `SortBy` in `src/lib/services/scoring-systems.ts`

2. **If a DB query is needed**, add a field to `ScoringContext` and run the query in the `Promise.all` block of `getLeaderboard` in `src/lib/services/leaderboard.ts`

3. **Add a descriptor** to `SCORING_SYSTEMS`:
   ```typescript
   {
     key: 'mySystem',
     lowerIsBetter: false,  // optional, default: higher is better
     compute: (userId, user, ctx) => {
       // return number | null
       return ctx.mySystemByUser.get(userId) ?? null
     },
   }
   ```

4. **Update the API route**: `SortBy` is re-exported from `leaderboard.ts`, so no change needed if it's already in `scoring-systems.ts`.

5. **Decide whether it is user-facing.** The leaderboard page deliberately renders only ELO, Accuracy and Brier (`SORT_OPTIONS` in `src/app/leaderboard/page.tsx`); a new system is API-only unless that decision is revisited. If it is surfaced, add a fixed column, a legend card, and i18n keys for `sortBy.mySystem` and `legend.mySystemTitle/Desc` in all 4 language files (`en.json`, `ru.json`, `he.json`, `eo.json`).

---

## Per-Tag Scoring

When a tag is selected via `?tag=slug`:

| System | Per-tag behaviour |
|--------|------------------|
| RS | Global (stored per user, not tag-filterable) |
| ELO | Materialized in `UserTagRating.elo`; seeded lazily, updated at resolution |
| Glicko-2 | Materialized in `UserTagRating.{mu,sigma,volatility}`; seeded lazily, updated at resolution |
| Brier Score | Filtered: only commitments on tagged predictions |
| Peer Score | Filtered |
| AI Score | Filtered |
| TruthScore | Filtered |
| ROI | Filtered |
| Weighted Peer Score | Filtered |
| Accuracy | Filtered |
| CU Committed | Filtered |
| Most Correct | Filtered |

ELO and Glicko-2 per-tag ratings start all users at default values within each tag scope, so the tag leaderboard represents "if this topic were all you ever predicted, how skilled would you be?" On first access for a tag, `ensureTagRatingsSeeded` seeds the table from a single replay; subsequent requests read directly from the materialized rows.

**Note:** Per-tag Glicko-2 requires ≥3 resolved predictions in the tag before a score is surfaced; users with fewer appear at the bottom (same as ROI and TruthScore). ELO has no minimum threshold.

**Profile page vs leaderboard:** The profile header card shows ELO from `ProfileScores.elo` (`loadProfileScores` in `src/lib/services/profile.ts`): the global `User.eloRating` with no tag, or the materialized `UserTagRating.elo` row when `?tag=` is set (seeding the tag via `ensureTagRatingsSeeded` first, exactly like the leaderboard). Glicko-2 is not shown on the profile.

---

## Implementation Files

| File | Role |
|------|------|
| `src/lib/services/scoring-systems.ts` | `SortBy`, `ScoringContext`, `ScoringSystem` interface, `SCORING_SYSTEMS` registry |
| `src/lib/services/leaderboard.ts` | Builds `ScoringContext`, runs aggregations, applies registry sort |
| `src/lib/services/profile.ts` | `loadProfileScores` — computes all metrics for the profile scores grid |
| `src/lib/services/elo.ts` | `calculateEloUpdates`, `replayEloHistory(tagSlug?)` |
| `src/lib/services/expertise.ts` | `glicko2Update`, `applyGlicko2Update`, `replayGlicko2History(tagSlug?)` |
| `src/lib/services/tag-ratings.ts` | `ensureTagRatingsSeeded(tagId, tagSlug)` — lazy seed; `updateTagRatingsInTx(tx, tags, commitments)` — incremental update at resolution |
| `src/app/leaderboard/page.tsx` | Client UI — ELO / Accuracy / Brier tabs and columns, tag filter, legend |
| `src/app/api/leaderboard/route.ts` | `GET /api/leaderboard?sortBy=&tag=&limit=` |
| `src/components/profile/ScoresGrid.tsx` | Profile page scores grid — Accuracy + Brier cards with explanations, calibration chart |

See also: [`docs/PROFILE_PAGE.md`](./PROFILE_PAGE.md) for the profile page architecture and per-user score display.

The public-facing `/methodology` page (`src/app/methodology/page.tsx`, `he` variant at `src/app/[locale]/methodology/page.tsx`) is a plain-language, worked-example version of this reference — linked from the `/about` page footer.

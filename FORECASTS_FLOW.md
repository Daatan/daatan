# DAATAN Forecasts - End-to-End Flow

> Implementation reference for the core Forecasts feature.
> See [GLOSSARY.md](./GLOSSARY.md) for terminology.

---

## Overview

```
[News Anchor] → [Forecast Draft] → [Define Outcome] → [Set Confidence] → [Active] → [Resolution]
```

---

## Step 1: Select News Anchor

### User Action
Pick a specific news story/event to attach the forecast to.

### System Requirements
- Create or reuse a `NewsAnchor` (dedupe/canonicalize if needed)
- Store snapshot of key fields so context won't drift if article changes:
  - `title`
  - `source`
  - `published_at`
  - `url_hash`

---

### Express create (URL + text)

The AI express flow (`src/lib/llm/expressPrediction.ts`) accepts free text, a bare
URL, **or a URL pasted alongside text** in a single field. A source link found
*anywhere* in the input (`extractFirstUrl`) is always used as the news anchor —
the user's link is never silently replaced by a search-engine result. If the page
can't be scraped (paywall, bot-blocking, non-HTTPS), the anchor is still built from
the URL's domain plus the user's own text, and the Oracul search is used only to
attach *related* links, never to pick the anchor. Only fully text-only input (no
URL) can raise `NoArticlesFoundError`.

The generated resolution deadline targets the topic's **natural resolution point**
(e.g. the election date), falling back to end-of-year only when no such date exists
— see the `express-prediction` prompt (Bedrock, with a repo fallback in
`src/lib/llm/bedrock-prompts.ts`).

## Step 2: Write Forecast (Draft)

### User Action
- Enter a short, testable forecast statement (`claim_text`)
- Optionally add details/conditions (`details_text`)
- Choose a domain (or auto-fill from anchor)

### System Storage (Minimum)
```
Prediction {
  status: "draft"
  author_user_id: string
  news_anchor_id: string
  claim_text: string
  details_text?: string
  domain: string
}
```

### Validation
- `claim_text` required (minimum length)
- Soft warning if statement is too vague or missing time-bound aspect

---

## Step 3: Define Outcome Type + Deadline

### User Action
1. Choose `outcome_type`:
   - **Binary** — will happen / won't happen
   - **Multiple Choice** — one option out of N
   - **Numeric Threshold** — metric crosses a defined value

2. Set `resolve_by_datetime` (deadline for resolution)

### System Storage
```
Prediction {
  ...
  outcome_type: "binary" | "multiple_choice" | "numeric"
  outcome_payload: object  // type-specific data
  resolve_by_datetime: datetime
  resolution_rules: string  // default: "resolved by official/reliable sources"
}
```

### Validation
| Type | Rules |
| ---- | ----- |
| All | `resolve_by_datetime` must be in the future |
| Multiple Choice | Min 2 options, no duplicates |
| Numeric | Valid number + defined metric/source |

---

## Step 4: Set Confidence + Publish (Lock)

### User Action
1. Set a confidence value:
   - **Binary**: drag the gauge needle or use the slider (-100 = certain NO → +100 = certain YES)
   - **Multiple Choice**: select an option and set a confidence level (1–100)
2. Press **Commit Forecast**

### System Requirements (Atomic Transaction)
1. Create `Commitment`:
   ```
   Commitment {
     prediction_id: string
     user_id: string
     cu_committed: number  // stores confidence value (-100..100 for BINARY, 1..100 for MC)
     rs_snapshot: number   // RS at commit time
     binary_choice: boolean | null  // derived server-side from sign of confidence
   }
   ```
2. Update Prediction:
   ```
   Prediction {
     status: "active"
     published_at: datetime
     locked_at: datetime
   }
   ```

### Rule
**After publish, prediction is immutable** — no edits to claim/outcome/deadline.

---

## Step 5: Forecast Page + Lifecycle

### Forecast Page Display
- News Anchor (with snapshot)
- Prediction text + details
- Outcome definition (Binary/MC/Numeric)
- Resolve-by deadline
- Commitment details (confidence %, RS snapshot, weight) — `cuCommitted` is the underlying
  DB field name (a holdover from the original CU-staking design, see
  `.kiro/specs/prediction-commitment/`), but no "CU" label is ever shown to users; the UI
  always converts it to a confidence percentage
- Tags (displayed as colored pills on forecast cards)

### Editing Forecasts
- Admins can edit any forecast; authors can edit their drafts
- Edit page at `/forecasts/[id]/edit` with form for:
  - Claim text, details, category, resolution rules, deadline
- Only changed fields are sent in the PATCH request
- Edit buttons on forecast cards and detail pages link directly to the editor

**Author-language editing.** A non-English author edits the forecast in their *own* language; the English canonical text is derived/normalized behind the scenes rather than typed by the author (see `src/lib/services/forecast.ts`, `src/lib/services/translation.ts`, and `EditForecastClient.tsx`). The forecast URL stays stable across edits — editing does not mint a new slug/id. Likewise, the express-create flow shows its preview in the author's original language.

### Feed Filtering
The feed supports three types of filters, all persisted in URL query params:
1. **Status** — Open, Closing Soon, Awaiting Resolution, Resolved, All
2. **Category** — domain-based dropdown
3. **Tags** — multi-select clickable tag chips (e.g. `?tags=AI,Crypto`)
   - Tags filter uses OR logic: predictions matching *any* selected tag are shown
   - Standard tags: Politics, Geopolitics, Economy, Technology, AI, Crypto, Sports, Entertainment, Science, Climate, Health, Business, Conflict, Elections, US Politics, Europe, Middle East, Asia, Energy, Space

Filter state is persisted in the URL (e.g. `?status=RESOLVED&tags=AI,Crypto`) so filters survive page refresh and can be shared via link.

### Prediction Statuses

| Status | Description |
| ------ | ----------- |
| `draft` | Created, not published |
| `active` | Published, awaiting resolution |
| `resolved_correct` | Resolved as correct |
| `resolved_wrong` | Resolved as wrong |
| `void` | Invalidated |
| `unresolvable` | Cannot be determined |

---

## Step 6: Resolution Trigger

Resolution starts when:
1. `resolve_by_datetime` arrives, **OR**
2. An earlier authoritative source enables resolution

---

## Step 7: Who Resolves

**Core Version:**
- System/moderator resolves based on defined rules and evidence
- No community voting in core implementation

---

## Step 8: Resolution Action

### System Storage
```
Prediction {
  resolution_outcome: "correct" | "wrong" | "void" | "unresolvable"
  evidence_link: string[]  // at least one URL
  resolved_at: datetime
  status: "resolved_correct" | "resolved_wrong" | "void" | "unresolvable"
}
```

---

## Resolution Rules (Core)

### Evidence Requirements
- Evidence is **mandatory** for every resolution (at least one link)
- Source priority: `official data > reputable news`

### Decision Logic

| Situation | Outcome |
| --------- | ------- |
| Clear evidence supports prediction | `correct` |
| Clear evidence contradicts prediction | `wrong` |
| Conflicting reliable sources, cannot decide | `unresolvable` |
| Deadline passed + no reliable data (within grace window) | `unresolvable` |
| Prediction canceled/invalidated (rule issues, broken anchor, abuse) | `void` |

---

## Brier Score + RS Effects

Resolution computes a Brier score for each commitment and awards or deducts RS accordingly.

**Probability mapping:**
- Binary: `p = (confidence + 100) / 200`  (so -100 → 0.0, 0 → 0.5, +100 → 1.0)
- Multiple Choice: `p = confidence / 100`

**ΔRS formula:** `rsChange = round((0.25 − brierScore) × 100)`
where `brierScore = (p − outcome)²` and outcome is 1 if the committed direction was correct, 0 otherwise.

| Outcome | RS Effect |
| ------- | --------- |
| `correct` (confident) | Up to +25 RS (perfect score) |
| `wrong` (confident) | Down to -75 RS |
| `neutral (50%)` | ±0 RS regardless of outcome |
| `void` | No RS change (brierScore not stored) |
| `unresolvable` | No RS change |

---

## Database Schema Reference

See `prisma/schema.prisma` for full schema. Key models:

- `User` — with RS (Reputation Score)
- `NewsAnchor` — news story snapshot
- `Prediction` — forecast statement
- `Commitment` — confidence value + Brier score result



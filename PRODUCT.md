# DAATAN Product Documentation

> Product vision, features, and roadmap for the reputation-based prediction platform.
> Last updated: September 2026

---

## Executive Summary

DAATAN is a reputation-based platform that enables users to test their understanding and predictions on news, politics, and current affairs — without money, with long-term accuracy measurement.

**The product doesn't measure profit — it measures understanding.**

| Attribute | Value |
|-----------|-------|
| Product Type | Reputation-based prediction platform |
| Target Market | Israel-first launch, expanding globally |
| Monetization | None (no real money involved) |
| Core Metric | Accuracy over time |

---

## Vision Statement

> "Prove you were right — without shouting into the void."

DAATAN creates a space where authority is earned through accuracy, not exposure. Users build long-term reputation by making testable predictions and being held accountable for their track record.

---

## Target Audience

### Primary Users
- Heavy news consumers
- People with opinions on politics and current affairs
- People who enjoy debates, commentary, and reality analysis

### Secondary Users
- Journalists and commentators
- Independent "experts"
- People who want to build authority through accuracy, not exposure

---

## What DAATAN Is NOT

| ❌ Not This | Why |
|-------------|-----|
| Gambling platform | No real money, no cash-out |
| Trading arena | No financial incentives |
| Real-money product | Reputation only |
| Consequence-free game | Every prediction affects track record |
| Engagement-first platform | Accuracy over engagement |

---

## Core Principles

### DO
- Measure accuracy over time
- Preserve track record permanently
- Turn statements into testable predictions
- Enable building authority through results
- Use gamification that serves measurement

### DON'T
- Reward noise over accuracy
- Allow gimmicks without consequences
- Prefer charisma over results
- Involve money or financial incentives

---

## Feature Fit Framework

Every feature must pass ALL checks before implementation:

1. ✅ Does it support long-term accuracy measurement?
2. ✅ Does it preserve or build track record?
3. ✅ Does it avoid financial incentives?
4. ✅ Does it serve measurement over engagement?
5. ✅ Is authority earned, not bought?

**If any check fails → out of scope.**

---

## Core Concepts

### ELO Rating (headline rating)
Since #1764, **ELO is the one rating shown to users**: the leaderboard (default sort), profile header, sidebar pill, forecast author line, activity feed and profile OG image all lead with `User.eloRating` (per-tag value when a tag is selected). The only other user-facing scores are **Accuracy** and **Brier**. Glicko, RS, peer/AI/truth scores and ROI are still computed but hidden. See [`docs/SCORING_SYSTEMS.md`](./docs/SCORING_SYSTEMS.md).

### Reputation Score (RS)
A user's long-term credibility/accuracy score based on past resolved predictions. Updates over time in an ELO-like way (expected outcome vs. actual outcome). Can increase or decrease (including becoming negative). Still computed (`User.rs`), but no longer displayed since ELO became the headline rating.

### Confidence Units (CU)
As implemented, a commitment carries a **confidence value from −100 to +100** (stored in `Commitment.cuCommitted`; the sign picks the side, the magnitude is conviction). There is no CU balance or per-period budget. Confidence:
- Has no monetary value
- Cannot be transferred
- Cannot be bought

### Prediction Weight
The influence/strength of a specific prediction in scoring/visibility calculations.

**Formula:** `Weight = RS × CU` (design concept — current scoring does not compute a combined weight; see [`docs/SCORING_SYSTEMS.md`](./docs/SCORING_SYSTEMS.md))

---

## Prediction System

### Prediction Types

| Type | Description | Example |
|------|-------------|---------|
| Binary | Will happen / Won't happen | "Bitcoin will exceed $100k by Dec 2026" |
| Multiple Choice | One option out of N | "Who will win the election: A, B, or C?" |
| Numeric Threshold | Metric crosses a value | "Unemployment will drop below 5%" |

### Prediction Lifecycle

```
[News Anchor] → [Draft] → [Define Outcome] → [Commit Confidence] → [Active] → [Resolution]
```

1. **Select News Anchor** — Pick a news story to attach the prediction to
2. **Write Prediction** — Create a testable forecast statement
3. **Define Outcome** — Choose type (binary/MC/numeric) and deadline
4. **Publish + Commit** — Publish, then commit a confidence value (−100..+100)
5. **Resolution** — System/moderator resolves based on evidence

### Resolution Outcomes

There is no lockable CU balance to unlock/refund — confidence is a Brier-scored
input, not staked currency. See [`docs/SCORING_SYSTEMS.md`](./docs/SCORING_SYSTEMS.md)
for the full formulas.

| Outcome | Description | Scoring Effect |
|---------|-------------|-----------|
| Correct | Prediction happened | Brier score vs. confidence; RS, Glicko-2, and ELO all update (can be + or −) |
| Wrong | Prediction did not happen | Same pipeline as Correct, scored against the opposite outcome |
| Void | Canceled/invalidated | No scoring effect — RS, Glicko-2, ELO all untouched |
| Unresolvable | Cannot be determined | No scoring effect — RS, Glicko-2, ELO all untouched |

---

## Current Features (September 2026)

Shipped on `main` for the SaaS edition; pointers to the owning code or doc:

- **Two creation flows** — Express (type an idea; the AI drafts claim, deadline, resolution rules and tags from a web/news search) and the step-by-step wizard (`src/components/forecasts/ForecastWizard.tsx`). See [FORECASTS_FLOW.md](./FORECASTS_FLOW.md).
- **Prediction-market links** — Polymarket/Kalshi markets can be imported in the wizard or pasted into Express (#1545); the linked market's live price is shown on the forecast and fed to the AI as a prior. Linked prices refresh hourly (`external-market-sync.yml`).
- **AI estimate** — each forecast gets a calibrated probability from the Oracul evidence pool, plus a multi-model AI panel with its own leaderboard (`/leaderboard/ai`).
- **Ratings** — ELO headline rating, Accuracy and Brier (#1764); global and per-tag leaderboards.
- **Sources leaderboard** — public at `/leaderboard/sources` (#1588); sources with fewer than 5 scored predictions are hidden from the public board. Per-source pages at `/sources/[name]`, pundit pages at `/authors/[author]`.
- **Retroanalysis case studies** — `/retroanalysis` (SaaS-only): Ukraine 2022 and Israel 2022 election (E02) reports rating what commentators said before the outcome (#1765–#1773).
- **Forget History** — in Settings, a user can detach themselves from their own already-resolved commitments without deleting the rows (so other users' scoring is unchanged); refused while they hold a commitment on an unresolved forecast (#1701, #1724). `POST /api/account/forget-history`.
- **Resolution** — AI resolution research plus moderator/resolver adjudication on the forecast page.
- **Social** — comments with reactions, share cards (OG images), notifications (in-app, email, browser push, Telegram).
- **Languages** — English, Hebrew, Russian, Esperanto.
- **Elections** — in-app `/elections` matrix of forecasts tagged "Israeli Elections 2026"; the sidebar also links to the separate `elections.daatan.com` app.
- **Android app** — TWA wrapper in `android/` (Play Store listing: `android/STORE_LISTING.md`).

---

## Feature Roadmap

### Phase 1: Core Web App (Weeks 1-4)
- ✅ User authentication (Google OAuth)
- ✅ Basic prediction creation
- ✅ Prediction feed
- ✅ LLM-assisted prediction creation
- ✅ One-click prediction flow
- ✅ Coin economy basics (superseded: confidence is a −100..+100 value, no coin balance)
- ✅ Personal leaderboards

### Phase 2: Widget & Sharing (Weeks 5-8)
- ⏳ Embeddable widget for publishers
- ✅ Sharing cards with OG images
- ⏳ Social platform integrations
- ⏳ Invite to bet functionality

### Phase 3: Adjudication & Pilot (Weeks 9-12)
- ✅ AI evidence-sourcing pipeline (Oracul evidence pool, AI resolution research)
- ✅ Human adjudication UI (moderator/resolver resolution on the forecast page)
- ⏳ Publisher pilot program
- ⏳ Feedback iteration

---

## Success Metrics

| Metric | Description | Target |
|--------|-------------|--------|
| Activation | % of viewers who create a prediction | 2-5% |
| Retention | 7/30-day DAU/MAU for active predictors | TBD |
| Engagement | Predictions per active user per week | TBD |
| Virality | Share-to-signup conversion rate | TBD |
| Quality | Average user calibration score (Brier) | Lower = better |
| Adjudication | % resolved without dispute | >95% |

---

## User Journey

### New User Flow
1. Discover DAATAN (via shared prediction, widget, or direct)
2. Sign in (Google or email/password)
3. Browse prediction feed
4. Create first prediction or commit to existing one
5. Build reputation over time

### Power User Flow
1. Monitor news for prediction opportunities
2. Create well-researched predictions
3. Commit with calibrated confidence across predictions
4. Track ELO growth over time
5. Build domain expertise (e.g., "Top Middle East Predictor")
6. Share predictions to build following

---

## Gamification Elements

### Serving Measurement (Allowed)
- ELO rating display (headline), plus Accuracy and Brier
- Domain-specific leaderboards
- Accuracy badges
- Streak tracking (for engagement, not scoring)
- Historical accuracy charts

### Out of Scope (Not Allowed)
- Momentary leaderboards without cumulative meaning
- Rewards that don't reflect accuracy
- Features that prioritize engagement over measurement
- Any form of real-money rewards

---

## Content Guidelines

### Allowed Topics
- Politics and elections
- Economics and markets
- Sports outcomes
- Technology predictions
- Current affairs

### Moderation Approach
- Evidence-based resolution
- Human review for disputes
- Void mechanism for problematic predictions
- Unresolvable status for ambiguous outcomes

---

## Environments

| Environment | URL | Purpose |
|-------------|-----|---------|
| Production | https://daatan.com | Live users |
| Staging | https://staging.daatan.com | Testing before production |
| Local | http://localhost:3000 | Development |

---

## Navigation (UI note)

On mobile, the header search icon opens an inline search field in the top bar — it does **not** open the left navigation drawer. See `src/components/Sidebar.tsx`.

---

## Related Documentation

- [DAATAN_CORE.md](./DAATAN_CORE.md) — Source of Truth (vision and principles)
- [Glossary](https://github.com/Daatan/docs/blob/main/glossary.md) — Terminology definitions (lives in the shared docs repo)
- [FORECASTS_FLOW.md](./FORECASTS_FLOW.md) — Prediction system implementation
- [GitHub Issues](https://github.com/Daatan/daatan/issues) — Development tasks and priorities (`P1`/`P2`/`P3`/`icebox` labels)
- [TECH.md](./TECH.md) — Technical architecture, infrastructure, and project structure
- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) — Deployment procedures and operations (canonical)

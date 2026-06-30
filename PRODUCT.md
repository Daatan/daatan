# DAATAN Product Documentation

> Product vision, features, and roadmap for the reputation-based prediction platform.
> Last updated: January 2026

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

### Reputation Score (RS)
A user's long-term credibility/accuracy score based on past resolved predictions. Updates over time in an ELO-like way (expected outcome vs. actual outcome). Can increase or decrease (including becoming negative).

### Confidence Units (CU)
A limited per-period budget of "confidence" a user can allocate across predictions. CU represent intensity/conviction but:
- Have no monetary value
- Cannot be transferred
- Cannot be bought

### Prediction Weight
The influence/strength of a specific prediction in scoring/visibility calculations.

**Formula:** `Weight = RS × CU`

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
[News Anchor] → [Draft] → [Define Outcome] → [Commit CU] → [Active] → [Resolution]
```

1. **Select News Anchor** — Pick a news story to attach the prediction to
2. **Write Prediction** — Create a testable forecast statement
3. **Define Outcome** — Choose type (binary/MC/numeric) and deadline
4. **Commit CU** — Allocate confidence units and publish
5. **Resolution** — System/moderator resolves based on evidence

### Resolution Outcomes

| Outcome | Description | CU Effect | RS Effect |
|---------|-------------|-----------|-----------|
| Correct | Prediction happened | Unlock | Changes (calculated) |
| Wrong | Prediction did not happen | Unlock | Changes (calculated) |
| Void | Canceled/invalidated | Refund | No change |
| Unresolvable | Cannot be determined | Unlock | No change |

---

## Feature Roadmap

### Phase 1: Core Web App (Weeks 1-4)
- ✅ User authentication (Google OAuth)
- ✅ Basic prediction creation
- ✅ Prediction feed
- ✅ LLM-assisted prediction creation
- ✅ One-click prediction flow
- ✅ Coin economy basics
- ✅ Personal leaderboards

### Phase 2: Widget & Sharing (Weeks 5-8)
- ⏳ Embeddable widget for publishers
- ⏳ Sharing cards with OG images
- ⏳ Social platform integrations
- ⏳ Invite to bet functionality

### Phase 3: Adjudication & Pilot (Weeks 9-12)
- ⏳ AI evidence-sourcing pipeline
- ⏳ Human adjudication UI
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
2. Sign in with Google
3. Receive initial CU balance (100 CU)
4. Browse prediction feed
5. Create first prediction or commit to existing one
6. Build reputation over time

### Power User Flow
1. Monitor news for prediction opportunities
2. Create well-researched predictions
3. Commit CU strategically across predictions
4. Track RS growth over time
5. Build domain expertise (e.g., "Top Middle East Predictor")
6. Share predictions to build following

---

## Gamification Elements

### Serving Measurement (Allowed)
- Reputation Score display
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
- [GLOSSARY.md](./GLOSSARY.md) — Terminology definitions
- [FORECASTS_FLOW.md](./FORECASTS_FLOW.md) — Prediction system implementation
- [TODO.md](./TODO.md) — Development tasks and priorities
- [TECH.md](./TECH.md) — Technical architecture, infrastructure, and project structure
- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) — Deployment procedures and operations (canonical)

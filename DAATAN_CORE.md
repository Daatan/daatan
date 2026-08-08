# DAATAN Core Document
_This document is the single source of truth for the DAATAN project._

## 1. Project Mission

DAATAN is a reputation-based prediction platform that measures users' understanding and accuracy in forecasting news, politics, and current affairs — without money, with long-term accuracy measurement.

**The product doesn't measure profit — it measures understanding.**

### Core Principles
- Measure accuracy over time, not engagement
- Preserve track record permanently
- Turn statements into testable predictions
- Authority is earned through results, not bought
- No real money, no gambling, no financial incentives

### Feature Fit Check
Every feature must pass ALL checks:
1. Does it support long-term accuracy measurement?
2. Does it preserve or build track record?
3. Does it avoid financial incentives?
4. Does it serve measurement over engagement?
5. Is authority earned, not bought?

If any check fails → out of scope.

## 2. Technology Stack
- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript 5
- **Frontend:** React 18, Tailwind CSS
- **Backend:** Next.js API Routes, Node.js 24
- **Database:** PostgreSQL 16 (Prisma 7.x ORM)
- **Authentication:** NextAuth.js (Google OAuth)
- **Testing:** Vitest
- **AI Integration:** Gemini (primary), Ollama (fallback), OpenRouter (bots), AWS Bedrock (prompt management)
- **Notifications:** Resend (email), web-push (browser push), Telegram
- **i18n:** next-intl
- **Infrastructure:** Docker, Nginx, AWS EC2, S3 (avatars)

## 3. Key Personnel
- **Project Lead:** Mark (@komapcc)

## 4. Operational Commands
- **Install Dependencies:** `npm install`
- **Run Dev Server:** `npm run dev`
- **Run Tests:** `npm test`
- **Build for Production:** `npm run build`
- **Start Production Server:** `npm run start`
- **Run Linter:** `npm run lint`

## 5. Key Concepts
- **Reputation Score (RS):** Long-term credibility score based on resolved predictions (ELO-like)
- **Confidence Units (CU):** Limited budget of conviction allocated across predictions (no monetary value)
- **Prediction Weight:** `RS × CU` — influence of a specific prediction
- **Brier Score:** Probability calibration metric, `(probability − outcome)²` — lower is better

See the [shared glossary](https://github.com/Daatan/docs/blob/main/glossary.md) for full terminology and [PRODUCT.md](./PRODUCT.md) for detailed product documentation.

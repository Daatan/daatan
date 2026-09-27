# Bot Approval Workflow

**Status:** ✅ Complete (v1.7.30, March 10–11, 2026; updated for confidence system v1.8.x, April 2026)

## Overview

The bot approval workflow allows administrators to configure bots that create predictions requiring manual approval before staking. This is useful for scoped bots (e.g., sports_bot, economics_bot) where human review ensures forecast quality.

## Features

### 1. Approval Requirement Flag

Bots can be configured to require approval with the `requireApprovalForForecasts` field:

```typescript
// BotConfig
requireApprovalForForecasts: Boolean @default(false)
```

When enabled:
- Forecasts are created with `PENDING_APPROVAL` status
- Bot does NOT stake immediately
- Human approval needed before forecast becomes `ACTIVE`
- On rejection, forecast transitions to `VOID`

### 2. Per-Bot Rate Limiting

Control how many forecasts a bot creates per hour:

```typescript
// BotConfig
maxForecastsPerHour: Int @default(0) // 0 = unlimited
```

The bot-runner checks this limit before creating each forecast and stops if reached.

### 3. Metadata Extraction

Bots can optionally extract metadata from article clusters:

```typescript
// BotConfig
enableSentimentExtraction: Boolean @default(false)
showMetadataOnForecast: Boolean @default(false)
```

Metadata stored on Prediction:
```typescript
sentiment: String?              // "positive" | "negative" | "neutral"
confidence: Int?                // 0–100
extractedEntities: String[]     // e.g., ["Israel", "Lebanon"]
consensusLine: String?          // "Based on 4 sources, 72% indicate..."
sourceSummary: String?          // Aggregated summary from articles
```

> **Current state:** `enableSentimentExtraction` and `showMetadataOnForecast` are stored and editable in the admin UI, but nothing reads them — the bot runner (`src/lib/services/bots/`) has no extraction step and never writes `sentiment`, `consensusLine` or `sourceSummary`, and the detail-page block below renders whenever those fields are populated, regardless of the flag. `Prediction.confidence` is not bot metadata either: it is the forecast's AI-estimate column (0–100, written by `recordEstimate` in `src/lib/services/context.ts`), so the block's "Confidence" line shows the AI estimate.

### 4. Topic Rejection Tracking

Prevent bots from re-suggesting rejected topics:

```typescript
// BotConfig
enableRejectionTracking: Boolean @default(false)

// New model
model BotRejectedTopic {
  id: String
  botId: String
  keywords: String[]
  description: String
  rejectedById: String
  rejectedAt: DateTime
}
```

When a forecast is rejected via `POST /api/forecasts/[id]/reject`, a `BotRejectedTopic` row is written for the author's bot **whether or not** tracking is enabled (`rejectForecast` in `src/lib/services/forecast.ts`). `enableRejectionTracking` gates the *read*: before creating a news-anchored forecast, `src/lib/services/bots/forecastCreate.ts` checks the bot's 20 most recent rejections and skips the forecast when ≥ 50% of a rejection's keywords appear in the new claim + details (plain keyword match, no LLM). The sourceless path does not run this check.

## API Endpoints

### Approve Forecast

**Endpoint:** `POST /api/forecasts/[id]/approve`

**Auth:** Admin or Approver (`roles: ['ADMIN', 'APPROVER']`)

**Behavior:**
1. Transition forecast from `PENDING_APPROVAL` → `ACTIVE`
2. Auto-stake using bot's configured stake range
3. Send Telegram notification of publication

**Response:**
```json
{
  "id": "pred-123",
  "status": "ACTIVE",
  "claimText": "🤖 Bitcoin will reach $100k by Dec 2026",
  "publishedAt": "2026-03-10T15:30:00Z"
}
```

### Reject Forecast

**Endpoint:** `POST /api/forecasts/[id]/reject`

**Auth:** Admin or Approver (`roles: ['ADMIN', 'APPROVER']`)

**Body (optional):**
```json
{
  "keywords": ["bitcoin", "crypto", "price"],
  "description": "Already covered by other forecasts"
}
```

When omitted, `keywords` defaults to the first 5 words of the claim (lower-cased) and `description` to its first 200 characters.

**Behavior:**
1. Transition forecast from `PENDING_APPROVAL` → `VOID`
2. Create `BotRejectedTopic` entry with keywords
3. Bot won't suggest similar topics again (if rejection tracking enabled)
4. Send Telegram notification (`notifyBotForecastRejected`) and ping IndexNow for the voided URL

**Response:**
```json
{
  "success": true,
  "prediction": {
    "id": "pred-123",
    "status": "VOID",
    "resolutionOutcome": "void"
  },
  "message": "Forecast rejected and topic added to rejection list"
}
```

## Bot Configuration Example

### Sports Bot with Approval

```typescript
// Create/update via admin UI
{
  userId: "bot-sports_123",
  personaPrompt: "You are a sports analyst tracking major sporting events...",
  forecastPrompt: "Create a specific, verifiable forecast about...",
  votePrompt: "As a sports expert, commit to forecasts about...",
  newsSources: [
    "https://feeds.bbci.co.uk/sport/rss.xml",
    "https://www.espn.com/espnfeed/feeds/rss/sports.xml"
  ],

  // Approval workflow
  requireApprovalForForecasts: true,

  // Rate limiting
  maxForecastsPerHour: 3,
  maxForecastsPerDay: 10,

  // Metadata & tracking
  enableSentimentExtraction: true,
  enableRejectionTracking: true,
  showMetadataOnForecast: true,

  // Staking
  stakeMin: 50,
  stakeMax: 150,

  // Schedule
  intervalMinutes: 30
}
```

## Admin UI Implementation

### Bot Configuration (Bots Tab)

**File:** `src/app/admin/_bots/EditBotModal.tsx` (opened from `src/app/admin/BotsTable.tsx`)

New fields in EditBotModal:
- **Require approval for forecasts** (checkbox)
  - When enabled: forecasts created with PENDING_APPROVAL status
  - Defers staking until manual approval
  - Default: false

- **Enable sentiment extraction** (checkbox)
  - When enabled: bot extracts sentiment from article clusters
  - Populates prediction.sentiment field
  - Default: false

- **Track rejected topics** (checkbox)
  - When enabled: rejected forecasts create BotRejectedTopic entries
  - Prevents bot from re-suggesting similar topics
  - Default: false

- **Show metadata on forecast** (checkbox)
  - When enabled: metadata block visible on forecast detail page
  - Shows sentiment, confidence, entities, consensus line
  - Default: false

- **Max forecasts/hour** (number field, 0 = unlimited)
  - Rate limit per hour; prevents runaway bot creation
  - Bot stops creating forecasts when hourly limit reached
  - Default: 0 (no limit, unlimited forecasts per hour)

**UI Pattern:**
```tsx
<div className="border rounded-lg p-3 space-y-3 bg-gray-50">
  <p className="text-xs font-semibold text-gray-500 uppercase">Actions & Approval</p>
  <label>Require approval for forecasts</label>
  <label>Enable sentiment extraction</label>
  <label>Track rejected topics</label>
  <label>Show metadata on forecast</label>
  <NumberField label="Max forecasts/hour" ... />
</div>
```

### Pending Approvals Tab

**File:** `src/app/admin/approvals/page.tsx`

Displays `PENDING_APPROVAL` forecasts with:
- Forecast claim text (truncated)
- Bot author name and handle
- Creation date + time
- Metadata badge (sentiment, confidence when available)
- Quick approve/reject buttons

**Workflow:**
1. Admin/approver opens Pending Approvals tab
2. Review bot-generated forecast claim
3. Click ✓ Approve → calls `POST /api/forecasts/[id]/approve`
   - Status changes to ACTIVE
   - Bot stakes automatically
   - Telegram notification sent
   - Forecast appears in live feed
4. Or click ✗ Reject → calls `POST /api/forecasts/[id]/reject`
   - Status changes to VOID
   - Topic added to rejection list
   - Telegram notification sent
   - Forecast removed from queue

### Forecast Detail Page

**File:** `src/app/forecasts/[id]/_forecast/BotApprovalSection.tsx` (rendered by `ForecastDetailClient.tsx`)

The PENDING_APPROVAL banner's Approve / Reject buttons do **not** call the endpoints above: they `PATCH /api/admin/forecasts/[id]` with `{ status: 'ACTIVE' | 'VOID' }`, which only changes the status — no bot stake, no `BotRejectedTopic`, no Telegram notification — and an `APPROVER` (as opposed to `ADMIN`) can only set `ACTIVE` there. Use the Pending Approvals tab for the full approve/reject behaviour.

Metadata display block in the PENDING_APPROVAL approval banner:

```tsx
{(prediction.sentiment || prediction.confidence != null) && (
  <div className="mt-3 p-3 bg-indigo-50 border border-indigo-100 rounded-lg">
    {prediction.sentiment && <SentimentBadge />}
    {prediction.confidence != null && <span>Confidence: {prediction.confidence}%</span>}
    {prediction.consensusLine && <p className="italic">"{prediction.consensusLine}"</p>}
    {prediction.extractedEntities && <EntityTags />}
  </div>
)}
```

**Visible only when:**
- Forecast status is PENDING_APPROVAL and the viewer is `ADMIN` or `APPROVER` (the whole banner is gated on `canApprove`)
- At least one of `sentiment`, `confidence`, `consensusLine` is populated

## Database Schema

### BotConfig (Enhanced)

```sql
ALTER TABLE "bot_configs" ADD COLUMN "requireApprovalForForecasts" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bot_configs" ADD COLUMN "enableSentimentExtraction" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bot_configs" ADD COLUMN "enableRejectionTracking" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bot_configs" ADD COLUMN "showMetadataOnForecast" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bot_configs" ADD COLUMN "maxForecastsPerHour" INTEGER NOT NULL DEFAULT 0;
```

### Prediction (Enhanced)

```sql
ALTER TABLE "predictions" ADD COLUMN "sentiment" VARCHAR(20);
ALTER TABLE "predictions" ADD COLUMN "confidence" INTEGER;
ALTER TABLE "predictions" ADD COLUMN "extractedEntities" TEXT[];
ALTER TABLE "predictions" ADD COLUMN "consensusLine" TEXT;
ALTER TABLE "predictions" ADD COLUMN "sourceSummary" TEXT;
```

### BotRejectedTopic (New)

```sql
CREATE TABLE "bot_rejected_topics" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "botId" TEXT NOT NULL,
  "keywords" TEXT[],
  "description" VARCHAR(500) NOT NULL,
  "rejectedById" TEXT NOT NULL,
  "rejectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bot_rejected_topics_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bot_configs" ("id") ON DELETE CASCADE,
  CONSTRAINT "bot_rejected_topics_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "users" ("id") ON DELETE CASCADE
);

CREATE INDEX "bot_rejected_topics_botId_idx" ON "bot_rejected_topics"("botId");
CREATE INDEX "bot_rejected_topics_rejectedAt_idx" ON "bot_rejected_topics"("rejectedAt");
```

## Bot Runner Implementation

The original monolithic `bot-runner.ts` was split into `src/lib/services/bots/{runner,stake,voting,shared}.ts`; the snippets below reflect current file locations.

### Approval Workflow in stake.ts

`createAndStake()` creates, publishes and (when allowed) stakes in one transaction:

```typescript
const publishStatus = bot.requireApprovalForForecasts
  ? 'PENDING_APPROVAL'
  : (bot.autoApprove ? 'ACTIVE' : 'PENDING_APPROVAL')

if (publishStatus === 'PENDING_APPROVAL') {
  // create + set publishStatus; no commitment — staking waits for /api/forecasts/[id]/approve.
  // Keyed on the status, not the flag: a bot with both flags off also lands in PENDING_APPROVAL,
  // and staking it at creation put a stake on an unapproved forecast (daatan#1775).
} else {
  const stake = randomInt(bot.stakeMin, bot.stakeMax)
  // create + set publishStatus + createCommitment(bot.userId, pred.id, { confidence: stake }, { tx })
  // (positive confidence = YES; a failed commitment rolls back the whole transaction)
}
```

> **Note:** `ensureBotCU()` was removed in v1.8.x. Bots no longer need a CU balance — commitments use the Brier confidence system directly.

### Hourly Rate Limiting

```typescript
// Check hourly limit before creating each forecast
if (bot.maxForecastsPerHour > 0) {
  const hourlyCount = await countThisHourActions(bot.id, 'CREATED_FORECAST')
  if (hourlyCount >= bot.maxForecastsPerHour) {
    log.info({ botId: bot.id }, 'Hourly forecast limit reached')
    break // Stop processing this batch
  }
}
```

## Testing

### Unit Tests

**API Route Tests:** `src/app/api/forecasts/[id]/__tests__/approve-reject.test.ts`
- ✅ POST /api/forecasts/[id]/approve
  - Status transitions: PENDING_APPROVAL → ACTIVE
  - publishedAt timestamp set correctly
  - Auto-stakes using randomInt(stakeMin, stakeMax)
  - Sends Telegram notification with approver info
  - Validates bot-only forecasts
  - Gracefully continues if staking fails (logs warning)

- ✅ POST /api/forecasts/[id]/reject
  - Status transitions: PENDING_APPROVAL → VOID
  - Creates BotRejectedTopic with provided keywords/description
  - Sends Telegram notification with rejector info
  - Validates bot-only forecasts
  - Returns success=true with prediction data

**Admin Bot API Tests:** `__tests__/api/admin-bots.test.ts`
- GET /api/admin/bots — lists all bots with new approval fields
- PATCH /api/admin/bots/[id] — updates approval config

### Test Coverage

Run tests with:
```bash
npm run test -- approve-reject.test.ts
npm run test -- admin-bots.test.ts
npm run test:coverage
```

Current coverage:
- Approval workflow: 100% (5 test cases)
- Rejection workflow: 100% (3 test cases)
- Error handling: 100% (auth, validation, forecast type validation)
- Database transitions: 100% (status, timestamps)

## Future Enhancements

1. **Batch Operations** - Approve/reject multiple forecasts at once
2. **Community Voting** - Allow users to vote on pending forecasts before approval
3. **Webhooks** - Notify external systems when forecasts are approved/rejected
4. **Audit Trail** - Track all approval/rejection decisions with detailed logs
5. **Sentiment Auto-Generation** - LLM extraction from article clusters (Stage 2)
6. **Approval Analytics** - Dashboard showing approval rates, common rejection reasons

## Implementation Details

### Data Flow: Approval Workflow

```
1. Bot runner creates forecast
   if (requireApprovalForForecasts) {
     status = PENDING_APPROVAL
     skip staking
   } else {
     status = autoApprove ? ACTIVE : PENDING_APPROVAL
     do stake
   }

2. Prediction created in database with:
   - status: 'PENDING_APPROVAL'
   - claimText, detailsText, etc.
   - [Optional] sentiment, confidence, extractedEntities
   - publishedAt: null (set on approval)

3. Admin views /admin/approvals
   - Fetches all PENDING_APPROVAL forecasts
   - Shows bot author, metadata, timestamps

4. Admin clicks ✓ Approve
   - POST /api/forecasts/[id]/approve
   - status → ACTIVE
   - publishedAt → now()
   - createCommitment(botUserId, predictionId, {
       confidence: random(stakeMin, stakeMax)  // binaryChoice derived from sign
     })
   - notifyBotForecastApproved(prediction, botAuthor, approver)

5. Forecast transitions to ACTIVE
   - Appears in live forecast feed
   - Users can commit to it
   - Bot's stake counted in total commitments
```

### API Response Contracts

**Approve Success (200):**
```json
{
  "id": "pred-123",
  "status": "ACTIVE",
  "claimText": "🤖 Bitcoin will reach $100k by Dec 2026",
  "publishedAt": "2026-03-11T15:30:00Z",
  "sentiment": "positive",
  "confidence": 75,
  "author": { "id": "...", "name": "CryptoBot", "isBot": true }
}
```

**Reject Success (200):**
```json
{
  "success": true,
  "prediction": {
    "id": "pred-123",
    "status": "VOID",
    "resolutionOutcome": "void"
  },
  "message": "Forecast rejected and topic added to rejection list"
}
```

**Errors (4xx):**
```json
{
  "error": "Only bot-created forecasts can be approved via this endpoint"
}
```

### Schema Relationships

```
BotConfig
├── requireApprovalForForecasts: Boolean
├── enableSentimentExtraction: Boolean
├── enableRejectionTracking: Boolean
├── showMetadataOnForecast: Boolean
├── maxForecastsPerHour: Int
└── user → User

Prediction
├── status: 'PENDING_APPROVAL' | 'ACTIVE' | 'VOID'
├── sentiment?: String
├── confidence?: Int
├── extractedEntities?: String[]
├── consensusLine?: String
├── sourceSummary?: String
└── author → User (isBot: true)

BotRejectedTopic
├── botId → BotConfig
├── keywords: String[]
├── description: String
├── rejectedById → User
└── rejectedAt: DateTime
```

## Troubleshooting

### Bot is creating forecasts but they're not staking

**Symptom:** Bot forecasts are in PENDING_APPROVAL status indefinitely.

**Cause:** `requireApprovalForForecasts` is true. Staking only happens after approval.

**Solution:**
1. Check BotConfig: `requireApprovalForForecasts` setting
2. Go to /admin/approvals
3. Click ✓ Approve on pending forecasts
4. Verify prediction.status changes to ACTIVE and staking happens

---

### Hourly rate limit not working

**Symptom:** Bot exceeds `maxForecastsPerHour` limit.

**Cause:** Limit is set to 0 (unlimited) or not being checked.

**Solution:**
1. Verify `maxForecastsPerHour > 0` on BotConfig
2. Check `src/lib/services/bots/runner.ts`: `countThisHourActions()` call
3. Set limit > 0 and re-run bot

---

### Rejected topics not preventing duplicates

**Symptom:** Bot re-suggests topics that were rejected before.

**Cause:** `enableRejectionTracking` is false on BotConfig.

**Solution:**
1. Enable `enableRejectionTracking` in bot config
2. Verify BotRejectedTopic records are created on rejection
3. Check `src/lib/services/bots/forecastCreate.ts`: keyword-overlap check (≥ 50% of a rejection's keywords) against the 20 most recent rejections

---

### Metadata fields are null on forecast

**Symptom:** Metadata block not visible on forecast detail page.

**Cause:** `enableSentimentExtraction` not enabled or not extracted during creation.

**Solution:**
1. Check BotConfig: `enableSentimentExtraction: true`
2. Verify forecast creator is bot (author.isBot: true)
3. Note: no bot code currently writes `sentiment` / `consensusLine` / `sourceSummary` (see [Metadata Extraction](#3-metadata-extraction)), so these stay null today even with the flag on
4. Look at prediction.sentiment, prediction.confidence fields in DB

---

### Telegram notification not sent

**Symptom:** Approval/rejection doesn't send Telegram message.

**Cause:** Missing TELEGRAM_BOT_TOKEN or invalid chat ID.

**Solution:**
1. Verify .env has valid TELEGRAM_BOT_TOKEN
2. Test with `/prod-status` command to check Telegram
3. Check logs: `notifyBotForecastApproved()` called but failed
4. Ensure Telegram bot token is refreshed from BotFather

---

### Staking fails but approval succeeds

**Symptom:** Forecast approved (ACTIVE) but bot didn't stake.

**Cause:** createCommitment() failed (validation error or server issue).

**Expected:** Approval still succeeds; warning logged.

**Why:** Approval is more critical than staking. Forecast should go live even if bot can't stake.

**Solution:**
1. Check bot-runner logs for createCommitment error
2. Verify stakeMin/stakeMax are configured sensibly on BotConfig
3. Re-run the bot or manually create a commitment via admin

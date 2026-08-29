# Prompts

Every prompt this app sends to a model lives in git, in one place, and is locked.

That was not true until #1658. Fourteen of the twenty prompts resolved at request time
through SSM → Bedrock Prompt Management → a 5-minute cache → an in-code fallback, so the
text that reached production lived in a console that `git log`, `git blame`, PR review and
`git revert` could not see. Two prompts had already silently drifted — `forecast-quality-validation`
lost a date-rule fix and `bot-forecast-generation` lost its stricter quality rules, both
corrected in git and never promoted. The Bedrock read path is gone.

## Where a prompt lives

| | |
|---|---|
| `src/lib/llm/bedrock-prompts.ts` | `PROMPTS` — **what runs.** `getPromptTemplate(name)` reads this record and applies `{{appName}}`. |
| `prompts/<name>.txt` | The human-editable mirror. Easier to read and diff than a TypeScript string literal. |
| `src/lib/llm/promptPairs.ts` | Which response schema pairs with which prompt. |
| `prompts/prompt_versions.lock.json` | The hash of both halves of every prompt. |

The runtime reads the record rather than the `.txt` files because the app builds with
`output: 'standalone'`, and `prompts/` is not copied into the runtime image — a `readFileSync`
would work in dev and CI and fail in production. `promptSync.test.ts` asserts the two copies
are byte-identical **in both directions**, so having two is a convenience, not a second source
of truth.

## A prompt is prose *and* a schema

This is the part worth internalising, and the reason the lock exists.

Thirteen of the twenty prompts ship with a response schema. Those schemas' `description`
fields are not documentation — they are instructions the model reads, in the same request,
with the same effect as a sentence in the prose. retro measured the schema half at **27% of
its extractor prompt** (retro#700).

Before #1658 the two halves were under separate change control. Editing
`expressPredictionSchema`'s descriptions changed what the model received with no Bedrock
version bump and no record; bumping Bedrock `:6 → :7` changed it with nothing in git. Neither
number described what actually reached the model.

`prompt_versions.lock.json` now pins both halves per prompt: `hash`/`chars` for the prose,
`schema_hash`/`schema_chars` for the schema as `JSON.stringify` emits it. `promptLock.test.ts`
fails when either moves and the lock does not. `chars` sits beside each hash so growth shows
up as a number in the diff — retro added that field after a prompt regression that a bare
hash change had made invisible.

Schema key order is part of the hash on purpose: reordering a schema's properties reorders
the fields the model generates, so it is a real change and reads as one.

## Changing a prompt

1. Edit **both** `prompts/<name>.txt` and the `PROMPTS` entry (they must match byte for byte).
2. `npx tsx scripts/update-prompt-lock.ts`
3. If the edit changes model behaviour materially, bump that entry's `version` in the lock by
   hand and add a row to the changelog below. The script never touches `version` — a number
   that increments automatically is the thing #1658 removed.
4. `npm test` — `promptSync.test.ts` and `promptLock.test.ts` must pass.

Editing a **schema** is editing a prompt. Same steps from 2.

Adding a prompt: add the `PromptName` member, the `PROMPTS` entry, the `.txt`, and an entry in
`PROMPT_SCHEMAS` (`null` if it has no schema). The last one is a type error until you do it,
which is the cheapest moment to notice a new prompt nothing watches.

## The prompts

`schema: —` means the prompt's output contract is prose: `forecast-quality-validation` asks
for JSON and the caller regex-parses it, `dedupe-check` answers yes/no, `topic-extraction`
returns a phrase. Those still lock their prose.

| Prompt | Schema | Used by |
|---|---|---|
| `backfill-rules` | `rulesSchema` | `POST /api/admin/forecasts/backfill-rules` |
| `bot-config-generation` | `botConfigGenerationSchema` | `admin/bots/route.ts` — generate a bot's config from its name |
| `bot-forecast-generation` | `forecastBatchSchema` | `bots/forecastCreate.ts` |
| `bot-sourceless-forecast-generation` | `forecastBatchSchema` | `bots/sourceless.ts` |
| `bot-vote-decision` | `voteDecisionSchema` | `bots/voting.ts` |
| `content-moderation` | `moderationSchema` | `services/moderation.ts` — forecast + comment creation |
| `dedupe-check` | — | `bots/forecastCreate.ts`, `bots/sourceless.ts` |
| `express-prediction` | `expressPredictionSchema` | `/api/forecasts/express` |
| `extract-prediction` | `predictionSchema` | `llm/gemini.ts` — forecast import |
| `forecast-quality-validation` | — | `bots/forecastCreate.ts`, `bots/sourceless.ts` |
| `guess-chances` | `guessChancesSchema` | `/api/forecasts/express/guess` |
| `panel-estimate` | — | `services/ai-panel.ts` (docs/LASSO.md) |
| `panel-estimate-grounded` | — | `services/ai-panel.ts` (docs/LASSO.md) |
| `relation-typer` | `relationTyperSchema` | `/api/cron/relation-typer` |
| `research-query-generation` | `queryGenerationSchema` | `/api/forecasts/[id]/research` |
| `resolution-research` | `researchSchema` | `/api/forecasts/[id]/research` |
| `suggest-tags` | `suggestTagsSchema` | tag suggestion API |
| `temporal-classifier` | `temporalClassifierSchema` | `services/temporal-classifier.ts` |
| `topic-extraction` | — | `llm/expressPrediction.ts` — article → search query |
| `update-context` | — | `/api/forecasts/[id]/context` |

Two prompts take untrusted text and say so in their own wording — `temporal-classifier` and
`panel-estimate-grounded` delimit the input and instruct the model to ignore instructions
inside it. #1657 extends that to `content-moderation` and `guess-chances`.

## Versions

All twenty start at `v1`. The Bedrock version numbers they carried until #1658 counted edits
to the prose alone, so they describe something different and are not carried forward; #1658
records what each was on.

| Prompt | Version | Change |
|---|---|---|
| all | v1 | 2026-08-29 — #1658: single source of truth in git, both halves locked. |

## Bedrock

Bedrock Prompt Management is no longer read at runtime. The prompts and their SSM parameters
still exist in both environments as of this writing and are pending teardown (#1658 step 7,
including the `daatan-translate` prompt that #1292 left behind at DRAFT after removing its SSM
parameters — the half git could see got cleaned up, the half only a console could see did not).
`terraform/bedrock_prompts.tf` still manages those parameters; it goes when they do.

Nothing reads them. Do not publish prompt edits there — they will have no effect.

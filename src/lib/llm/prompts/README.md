# LLM Prompts (Bedrock)

All prompt templates are managed in **AWS Bedrock Prompt Management** (eu-central-1) and referenced via **SSM Parameter Store**. The app fetches templates at runtime via `src/lib/llm/bedrock-prompts.ts`. If SSM is `PLACEHOLDER` or Bedrock is unreachable, the hardcoded fallback in `FALLBACK_PROMPTS` is used.

**Source of truth**: All prompts are stored as `.txt` files in `prompts/` at the repo root. Edit there, then publish to Bedrock using `scripts/create-bedrock-prompt.sh`.

| Prompt Name | Bedrock ID | Version | Used By | Purpose |
|-------------|-----------|---------|---------|---------|
| `bot-config-generation` | `V7KWZIDZ5G` | `:2` | Admin: create bot | Generate persona, forecast/vote prompts, and RSS sources from bot name |
| `bot-forecast-generation` | `4VVM1AE8WG` | `:2` | Bot runner | Create a verifiable forecast JSON from a hot RSS topic |
| `bot-vote-decision` | `FMSCSIWJ0N` | `:2` | Bot runner | Decide whether and how to vote on an open forecast |
| `content-moderation` | `7DWWBJAS1O` | `:1` | Forecast + comment creation | Validate content against safety policies; geopolitical forecasts explicitly allowed |
| `dedupe-check` | `E3UJXEIV39` | `:2` | Bot runner | Detect if a new topic duplicates an existing active forecast |
| `express-prediction` | `0BXFPNKYL4` | `:3` | `/api/forecasts/express` | Convert a user's casual text into a structured prediction |
| `extract-prediction` | `P3QR7PR50J` | `:2` | Forecast import tools | Extract a structured prediction from arbitrary article text |
| `forecast-quality-validation` | `MZU2SJWY74` | `:2` | Bot runner | Validate a bot-generated forecast before publishing |
| `guess-chances` | fallback only | — | Express flow | Suggest probability (0–100%) for a forecast based on news context |
| `relation-typer` | fallback only | — | `/api/cron/relation-typer` | Type the logical relation (alias/nested/threshold/complement/exclusive/implies) between two similar forecasts — retro#574 |
| `research-query-generation` | `GQK8IGH3H9` | `:2` | Auto-resolution | Generate web search queries to find resolution evidence |
| `resolution-research` | `9BJAASRX0U` | `:2` | Auto-resolution | Determine forecast outcome from news context or model knowledge |
| `suggest-tags` | `4GRPW480KQ` | `:2` | Tag suggestion API | Suggest 1–3 relevant tags for a forecast |
| `topic-extraction` | `7EKX6FRNE0` | `:2` | Bot runner / RSS | Extract a 5–10 word search query from an article |
| `translate` | `6I0TDPIMBX` | `:2` | Translation feature | Translate forecast text to a target language |
| `update-context` | `OX9GBXOT0B` | `:2` | Forecast detail page | Write a neutral 2–3 sentence summary of current news context |

## How to Update a Prompt

1. Edit the relevant file in `prompts/<name>.txt`.
2. Publish a new version to Bedrock (staging first):
   ```bash
   ./scripts/create-bedrock-prompt.sh <name> prompts/<name>.txt --env staging
   ```
3. Validate on staging, then promote to prod:
   ```bash
   ./scripts/promote-prompt.sh prod <name> <new-arn>
   ```
4. The app picks up the new version within 5 minutes (cache TTL).
5. To rollback: `./scripts/promote-prompt.sh <env> <name> --rollback`

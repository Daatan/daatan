# Embeddings & Similar-Forecasts

Vector embeddings power the "similar forecasts" lookup on the forecast detail page and feed (replacing the old Jaccard text similarity). This doc covers the model, schema, query path, and backfill flow.

## Stack

- **Model:** `gemini-embedding-2`, served via Vertex AI (Developer API fallback is self-host only — see below)
- **Dimensionality:** `768` (set via `outputDimensionality=768` request parameter; the model natively emits 3072 dims)
- **Storage:** PostgreSQL with the `pgvector` extension, `vector(768)` column on `predictions`
- **Index:** HNSW with cosine operator (`vector_cosine_ops`)
- **Distance metric:** Cosine; threshold `>= 0.75` for "similar"

## Generation

`src/lib/services/embedding.ts` calls `embedContent`, on Vertex AI when the service
account is provisioned (daatan#1472) and on the Developer API otherwise:

```
POST https://aiplatform.googleapis.com/v1/projects/{project}/locations/{location}
       /publishers/google/models/gemini-embedding-2:embedContent     ← Bearer, preferred
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=
```

Same model and same body on both — the only differences are the host and Bearer auth
instead of `?key=`, plus the `model` field which Vertex takes from the URL. Vertex is
preferred because Google is forcing the Developer API from Postpay to **Prepay** by
**2026-09-14**, introducing a prepaid balance that can hit zero; Vertex bills as an
ordinary GCP service. See [LLM_ARCHITECTURE.md](LLM_ARCHITECTURE.md).

Request body includes `outputDimensionality: 768`. The 768-dim output matches the column definition; do not change one without the other (changing dims requires re-running the migration with a new column type and full backfill). A response of any other length is rejected before it can reach the column.

The text being embedded is the prediction's `claimText` plus `detailsText` if present.

Required env: all three of `GOOGLE_VERTEX_PROJECT_ID` / `GOOGLE_VERTEX_CLIENT_EMAIL` /
`GOOGLE_VERTEX_PRIVATE_KEY` — or, on **self-host**, `GEMINI_API_KEY` instead (a
self-hoster has no GCP service account). Daatan's own prod and staging bundles no longer
carry `GEMINI_API_KEY` at all (#1472).

**The two platforms return the same vectors.** Measured on prod over 20 real `claimText`
values (2026-08-19): cosine 1.000000 on every sample, and the components were
*bit-identical* (max |delta| = 0), against a cross-text control of 0.763. So vectors
written by either path are interchangeable and **no re-embedding was needed** when
production cut over to Vertex.

**`embedAndStoreForecast()` throws when it stores nothing** — on a null vector and on
non-finite values alike. It used to return silently on both, which meant the two backfill
routes (`/api/cron/backfill-embeddings`, `/api/admin/backfill-embeddings`) counted a skipped
row as `done`: a run that wrote nothing answered `{done: 20, failed: 0}`, indistinguishable
from a good one. Only `remaining` gave it away, and the admin route doesn't return that.
Every caller already had a `.catch()` or try/catch, so the fire-and-forget ones simply gained
the error log they should always have had.

**A Vertex failure is invisible to callers.** On self-host the Developer API silently
rescues it and embeddings keep working. On daatan.com there is no key to rescue with, so a
Vertex failure means the forecast is left *unembedded* instead. Either way the one signal
is the `vertex-embed-failed` error log — grep for it before assuming the Vertex path works.

## Schema

`prisma/schema.prisma:329` (Prediction model):

```prisma
embedding Unsupported("vector(768)")?
```

Prisma marks pgvector types as `Unsupported` since it has no native vector support. Reads/writes go through raw SQL in `src/lib/services/forecast.ts` and `embedding.ts`.

The migration that added the column and HNSW index:

`prisma/migrations/20260430000000_add_prediction_embedding/migration.sql`

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS embedding vector(768);
CREATE INDEX IF NOT EXISTS predictions_embedding_hnsw_idx
  ON predictions USING hnsw (embedding vector_cosine_ops);
```

Prereq: the postgres image must include pgvector. Production now uses `pgvector/pgvector:pg16` (see `docker-compose.prod.yml`); using the stock `postgres:16-alpine` image will fail this migration with `extension "vector" is not available`.

## Similar-forecasts query

`GET /api/forecasts/similar?id=<id>&limit=3` (or `?q=<text>&tags=<csv>&limit=3`).

The route delegates to `findSimilarForecasts()` in `src/lib/services/forecast.ts:344`. Core SQL:

```sql
SELECT p.id, p.claim_text, ...,
       (1 - (p.embedding <=> $vector::vector))::float AS score
FROM predictions p
WHERE p.embedding IS NOT NULL
  AND p.id != $excludeId
  AND p.status = 'ACTIVE'
HAVING (1 - (p.embedding <=> $vector::vector)) >= 0.75
ORDER BY p.embedding <=> $vector::vector
LIMIT $limit
```

`<=>` is pgvector's cosine distance operator. `1 - distance` gives cosine similarity in `[-1, 1]`. The 0.75 threshold means "≥75% cosine similarity"; tune by editing the constant in `forecast.ts:320`.

> **Known limitation / planned redesign:** this matches on `claimText` alone, so the
> deadline is embedded as text while the structured `resolveByDatetime` is unused —
> two "within 90 days" forecasts created months apart embed identically. See
> [`SIMILAR_FORECASTS.md`](./SIMILAR_FORECASTS.md) for the proposed deadline-aware,
> two-stage scoring redesign.

## Backfill

Three backfill paths exist. All three select on `embedding IS NULL`, so none of them will ever revisit a **stale** vector — see the note under "When to re-embed".

### Scheduled sweep (the one that runs on its own)

`GET /api/cron/backfill-embeddings` — auth via the `x-cron-secret` header (`BOT_RUNNER_SECRET`). Embeds up to 20 rows per call. Driven nightly at 02:23 UTC by [`.github/workflows/backfill-embeddings.yml`](../.github/workflows/backfill-embeddings.yml).

This is the safety net for the fire-and-forget embed on forecast creation: if that call fails, the forecast saves with no vector and nothing else retries it. The workflow fails loudly when the response reports a non-zero `failed`, because the route answers 200 even when every embed in the batch errored.

Added in #1369. Before that the route existed but had no scheduler — the docstring pointed at an EC2 crontab that does not exist on the box — so nothing swept, and 39 predictions from Feb–May 2026 sat unembedded (#1371).

### Admin endpoint (online)

`POST /api/admin/backfill-embeddings` — requires `role=ADMIN`. Iterates all predictions where `embedding IS NULL` in batches of 10, calls `embedAndStoreForecast()` per row, returns done/failed counts. Idempotent — safe to call repeatedly. Use this for incremental backfill after deploys, or after manually inserted predictions.

### One-time script

`scripts/backfill-embeddings.ts` — for the initial mass backfill. Batch size 20, 500ms inter-batch delay (rate-limit safety). **Note:** this script currently calls `text-embedding-004` (the older model), not `gemini-embedding-2`. The two models are dimensionally compatible at 768 but not interchangeable for similarity scoring. If re-running, port the call site to `embeddingService.embed()` so all rows share the same vector space. New rows created after the model migration use `gemini-embedding-2` via `embedding.ts`.

## When to re-embed

- **New forecast created:** automatic (called from the forecast-creation flow)
- **Forecast claimText edited:** automatic since #1368, on both edit paths — `directUpdateForecast()` for English, `saveOriginalLanguageEdit()` for a forecast authored in another language. Only `claimText` matters here: the vector is built from the claim alone, so editing `detailsText` or `resolutionRules` cannot stale it
- **Model upgrade:** every existing row needs a re-embed (vector spaces are not portable across models)

> A **stale** embedding is invisible to both backfill paths above — they select on `embedding IS NULL`, and a vector describing the old wording is not null. Nothing sweeps it up, so any new write path that changes `claimText` must re-embed at the call site or the drift is permanent. This is what #1368 fixed for the English edit path.

## Failure modes

- Gemini 401 / quota errors **on create** → forecast still saves; embedding stays NULL → forecast simply won't appear in similarity results until backfilled
- Gemini 401 / quota errors **on edit** → the edit still saves, but the *previous* vector survives, so the forecast keeps matching on wording it no longer has. Worse than the create case: not being NULL, it is invisible to both backfills and nothing retries it. The re-embed is deliberately non-fatal (logged, not thrown) so a Gemini outage can't block a claim correction — the trade is that the drift is silent
- pgvector extension missing → migration fails (P3009). Recovery: see the prod incident in `docs/PRISMA_MIGRATE_DEPLOY_DEPS.md` and the resolved runbook for swapping to `pgvector/pgvector:pg16`

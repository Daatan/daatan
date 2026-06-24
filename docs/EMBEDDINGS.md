# Embeddings & Similar-Forecasts

Vector embeddings power the "similar forecasts" lookup on the forecast detail page and feed (replacing the old Jaccard text similarity). This doc covers the model, schema, query path, and backfill flow.

## Stack

- **Model:** `gemini-embedding-2`, served via the Gemini REST API
- **Dimensionality:** `768` (set via `outputDimensionality=768` request parameter; the model natively emits 3072 dims)
- **Storage:** PostgreSQL with the `pgvector` extension, `vector(768)` column on `predictions`
- **Index:** HNSW with cosine operator (`vector_cosine_ops`)
- **Distance metric:** Cosine; threshold `>= 0.75` for "similar"

## Generation

`src/lib/services/embedding.ts` calls Gemini's `embedContent` endpoint:

```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent
```

Request body includes `outputDimensionality: 768`. The 768-dim output matches the column definition; do not change one without the other (changing dims requires re-running the migration with a new column type and full backfill).

The text being embedded is the prediction's `claimText` plus `detailsText` if present.

Required env: `GEMINI_API_KEY`.

## Schema

`prisma/schema.prisma:240` (Prediction model):

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

The route delegates to `findSimilarForecasts()` in `src/lib/services/forecast.ts:261`. Core SQL:

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

`<=>` is pgvector's cosine distance operator. `1 - distance` gives cosine similarity in `[-1, 1]`. The 0.75 threshold means "≥75% cosine similarity"; tune by editing the constant in `forecast.ts:237`.

> **Known limitation / planned redesign:** this matches on `claimText` alone, so the
> deadline is embedded as text while the structured `resolveByDatetime` is unused —
> two "within 90 days" forecasts created months apart embed identically. See
> [`SIMILAR_FORECASTS.md`](./SIMILAR_FORECASTS.md) for the proposed deadline-aware,
> two-stage scoring redesign.

## Backfill

Two backfill paths exist:

### Admin endpoint (online)

`POST /api/admin/backfill-embeddings` — requires `role=ADMIN`. Iterates all predictions where `embedding IS NULL` in batches of 10, calls `embedAndStoreForecast()` per row, returns done/failed counts. Idempotent — safe to call repeatedly. Use this for incremental backfill after deploys, or after manually inserted predictions.

### One-time script

`scripts/backfill-embeddings.ts` — for the initial mass backfill. Batch size 20, 500ms inter-batch delay (rate-limit safety). **Note:** this script currently calls `text-embedding-004` (the older model), not `gemini-embedding-2`. The two models are dimensionally compatible at 768 but not interchangeable for similarity scoring. If re-running, port the call site to `embeddingService.embed()` so all rows share the same vector space. New rows created after the model migration use `gemini-embedding-2` via `embedding.ts`.

## When to re-embed

- **New forecast created:** automatic (called from the forecast-creation flow)
- **Forecast claimText/detailsText edited:** not automatic — currently the embedding goes stale. If editing becomes common, hook this into the PATCH route
- **Model upgrade:** every existing row needs a re-embed (vector spaces are not portable across models)

## Failure modes

- Gemini 401 / quota errors → forecast still saves; embedding stays NULL → forecast simply won't appear in similarity results until backfilled
- pgvector extension missing → migration fails (P3009). Recovery: see the prod incident in `docs/PRISMA_MIGRATE_DEPLOY_DEPS.md` and the resolved runbook for swapping to `pgvector/pgvector:pg16`

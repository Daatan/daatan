-- Per-forecast evidence pool foundation layer (retro docs/ORACLE_VARIABLES.md §6
-- part 2, 2026-07-09). Nothing reads this table to compute an estimate yet;
-- analyze/news-indexer/backfill shadow-write their per-source signals here in
-- addition to their existing writes, so real data accumulates ahead of the
-- future recompute-over-pool cutover.

CREATE TABLE "evidence_pool_articles" (
  "id"                    TEXT             NOT NULL,
  "predictionId"          TEXT             NOT NULL,
  "url"                   VARCHAR(2000)    NOT NULL,
  "url_hash"              VARCHAR(64)      NOT NULL,
  "title"                 VARCHAR(500),
  "source"                VARCHAR(200),
  "published_date"        TEXT,
  "stance"                DOUBLE PRECISION,
  "certainty"             DOUBLE PRECISION,
  "credibility_weight"    DOUBLE PRECISION,
  "claims"                JSONB            NOT NULL DEFAULT '[]',
  "settled"               BOOLEAN,
  "quantitative_estimate" DOUBLE PRECISION,
  "origin"                VARCHAR(32)      NOT NULL,
  "excluded"              BOOLEAN          NOT NULL DEFAULT false,
  "added_at"              TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3)     NOT NULL,
  CONSTRAINT "evidence_pool_articles_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "evidence_pool_articles"
  ADD CONSTRAINT "evidence_pool_articles_predictionId_fkey"
  FOREIGN KEY ("predictionId") REFERENCES "predictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "evidence_pool_articles_predictionId_url_hash_key" ON "evidence_pool_articles"("predictionId", "url_hash");
CREATE INDEX "evidence_pool_articles_predictionId_idx" ON "evidence_pool_articles"("predictionId");

-- Persist the per-article relevance bar in force when a pool row was admitted
-- (retro#393/#394, ForecastResponse.relevance_bar, PR retro#404). 0.0 means no
-- bar was applied, matching /forecast's behaviour today.
--
-- SHADOW / storage only — deliberately NOT read by any estimate or
-- aggregation, like `author_lean` and `fact_signal`. Additive, nullable, no
-- default, no backfill: pool rows are a contentHash extraction cache, so this
-- populates only on NEW extractions via /forecast; the /pool/aggregate
-- recompute path never returns a bar to persist. It exists so that once the
-- bar moves off 0.0, history stays auditable — which admission regime
-- produced each row is a property of the row, not recoverable after the fact.

ALTER TABLE "evidence_pool_articles" ADD COLUMN "relevance_bar" DOUBLE PRECISION;

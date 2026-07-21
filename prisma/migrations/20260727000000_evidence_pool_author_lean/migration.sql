-- Persist the byline author's OWN directional forecast per pooled article
-- (retro #308/#309, surfaced on /forecast's SourceSignal): author_lean in
-- [-1,1] (+1 the author expects the event, -1 expects not, 0 weighs both),
-- author_lean_certainty in [0,1] (how firmly they commit). Both null when the
-- author only reported facts or relayed others' views.
--
-- SHADOW / author-scoring lane only — deliberately NOT read by any estimate or
-- aggregation (the un-fusing work). Additive, nullable, no default, no backfill:
-- pool rows are a contentHash extraction cache, so these populate only on NEW
-- extractions. Live `stance` and the current forecast are untouched.

ALTER TABLE "evidence_pool_articles" ADD COLUMN "author_lean" DOUBLE PRECISION;
ALTER TABLE "evidence_pool_articles" ADD COLUMN "author_lean_certainty" DOUBLE PRECISION;

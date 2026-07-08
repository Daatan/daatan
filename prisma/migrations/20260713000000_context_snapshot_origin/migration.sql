-- recordEstimate funnel (retro docs/ORACLE_VARIABLES.md §6): structured provenance
-- for every estimate write, replacing the externalReasoning marker-string convention.
-- Nullable: rows written before the funnel existed have no origin.
ALTER TABLE "context_snapshots" ADD COLUMN "origin" VARCHAR(32);

-- Evidence volume behind this estimate (Oracle articles_used). Enables a future
-- overwrite policy (don't clobber a richer estimate with a poorer one). Null when
-- unknown: legacy rows, LLM-fallback runs, clock requotes.
ALTER TABLE "context_snapshots" ADD COLUMN "articles_used" INTEGER;

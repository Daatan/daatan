-- Grounded-indexer panel mode (docs/LASSO.md §9a).

-- The article set retrieved for a run's grounded members, frozen at run creation so a
-- completion pass re-asks against identical input. NULL = ungrounded-only run.
ALTER TABLE "ai_estimate_runs" ADD COLUMN "context_snapshot" JSONB;

-- Member identity in scores gains the mode axis: a grounded twin shares its sibling's
-- model string, so (commitment_id, model) alone would collide at resolution time.
ALTER TABLE "ai_member_scores" ADD COLUMN "mode" VARCHAR(16) NOT NULL DEFAULT 'ungrounded';

-- Every estimate to date is ungrounded (the default covers members); the oracle/market
-- benchmark rows are not panel members and get the sentinel mode instead.
UPDATE "ai_member_scores" SET "mode" = 'sentinel' WHERE "model" IN ('oracle', 'market');

DROP INDEX "ai_member_scores_commitment_id_model_key";
CREATE UNIQUE INDEX "ai_member_scores_commitment_id_model_mode_key" ON "ai_member_scores"("commitment_id", "model", "mode");

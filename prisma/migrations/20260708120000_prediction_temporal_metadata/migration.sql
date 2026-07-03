-- Temporal-model metadata (retro/docs/TEMPORAL_MODEL_PLAN.md #3.4): classified
-- once at forecast creation by an LLM call, plus a one-shot admin backfill for
-- pre-existing forecasts. All columns nullable — no rewrite, no default needed.
CREATE TYPE "ClaimDirection" AS ENUM ('ARRIVAL', 'SURVIVAL', 'NONE');
CREATE TYPE "ClaimArchetype" AS ENUM ('DIFFUSE', 'SCHEDULED', 'THRESHOLD', 'NONE');

ALTER TABLE "predictions" ADD COLUMN "claim_deadline" TIMESTAMP(3);
ALTER TABLE "predictions" ADD COLUMN "claim_direction" "ClaimDirection";
ALTER TABLE "predictions" ADD COLUMN "claim_archetype" "ClaimArchetype";
ALTER TABLE "predictions" ADD COLUMN "tau_lead_days" INTEGER;
ALTER TABLE "predictions" ADD COLUMN "classifier_version" VARCHAR(40);
ALTER TABLE "predictions" ADD COLUMN "classified_at" TIMESTAMP(3);
ALTER TABLE "predictions" ADD COLUMN "classifier_output" JSONB;

-- Daily requote cron support (retro docs/TEMPORAL_MODEL_PLAN.md #4 Stage 0).

-- Clock-driven snapshots are tagged distinctly from evidence-driven ones so
-- they can be excluded from the timeline, anchor selection, and the
-- news-indexer dedup check. All existing rows backfill to 'evidence'.
ALTER TABLE "context_snapshots" ADD COLUMN "kind" VARCHAR(32) NOT NULL DEFAULT 'evidence';
ALTER TABLE "context_snapshots" ADD COLUMN "meta" JSONB;

-- Single-shot alert dedup, re-armed by comparing against the current deadline
-- rather than a plain NULL check (see temporal-clock.ts dueForAlert).
ALTER TABLE "predictions" ADD COLUMN "deadline_passed_alert_at" TIMESTAMP(3);
ALTER TABLE "predictions" ADD COLUMN "teff_provisional_alert_at" TIMESTAMP(3);
ALTER TABLE "predictions" ADD COLUMN "divergence_alert_at" TIMESTAMP(3);

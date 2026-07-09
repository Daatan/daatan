-- AI Panel (docs/AI_PANEL.md): a multi-model probability source charted alongside
-- the Oracle needle, the crowd, and external markets.
--
-- ISOLATION IS THE POINT. Nothing here touches predictions.confidence /
-- predictions.ai_ci_low / predictions.ai_ci_high. The gauge (Speedometer) reads only
-- those columns, and only recordEstimate() writes them — so no panel value can reach
-- the needle, the high-confidence Telegram alert, awaiting_ai_resolution, or any
-- ELO/Glicko/leaderboard path. Adding a column here can never change a user's score.

-- One sweep over one forecast: every member's estimate at the same instant.
-- input_hash is the date-gate; the unique index below makes the cron idempotent.
CREATE TABLE "ai_estimate_runs" (
    "id" TEXT NOT NULL,
    "prediction_id" TEXT NOT NULL,
    "input_hash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_estimate_runs_pkey" PRIMARY KEY ("id")
);

-- One member's probability within one run. `model` and `mode` are VARCHAR, not enums,
-- so adding a panel member never requires a migration. `prompt_version` is part of
-- member identity: a prompt change makes prior Brier scores incomparable.
CREATE TABLE "ai_estimates" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "model" VARCHAR(64) NOT NULL,
    "mode" VARCHAR(16) NOT NULL,
    "prompt_version" VARCHAR(32) NOT NULL,
    "probability" INTEGER,
    "insufficient_data" BOOLEAN NOT NULL DEFAULT false,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "latency_ms" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_estimates_pkey" PRIMARY KEY ("id")
);

-- Matched-time Brier: which panel run was current when this user staked.
-- A run FK rather than a scalar probability, so every member stays recoverable.
-- Nullable — commits placed before the panel's first run simply drop out of the
-- aggregates, exactly as a null brier_score already does.
ALTER TABLE "commitments" ADD COLUMN "ai_run_id_at_commit" TEXT;

CREATE UNIQUE INDEX "ai_estimate_runs_prediction_id_input_hash_key" ON "ai_estimate_runs"("prediction_id", "input_hash");
CREATE INDEX "ai_estimate_runs_prediction_id_createdAt_idx" ON "ai_estimate_runs"("prediction_id", "createdAt");
CREATE UNIQUE INDEX "ai_estimates_run_id_model_mode_key" ON "ai_estimates"("run_id", "model", "mode");
CREATE INDEX "ai_estimates_run_id_idx" ON "ai_estimates"("run_id");
CREATE INDEX "commitments_ai_run_id_at_commit_idx" ON "commitments"("ai_run_id_at_commit");

ALTER TABLE "ai_estimate_runs" ADD CONSTRAINT "ai_estimate_runs_prediction_id_fkey"
    FOREIGN KEY ("prediction_id") REFERENCES "predictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_estimates" ADD CONSTRAINT "ai_estimates_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "ai_estimate_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: deleting a run must never delete a user's commitment.
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_ai_run_id_at_commit_fkey"
    FOREIGN KEY ("ai_run_id_at_commit") REFERENCES "ai_estimate_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

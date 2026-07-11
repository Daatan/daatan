-- Matched-time Brier per panel member per commitment (docs/AI_PANEL.md §7).
-- One row per (commitment, member), written at resolution: the member's probability in
-- the run current when the user staked, scored against the outcome — directly comparable
-- to the human's own Commitment.brier_score on that same commitment.
--
-- 'oracle' is a valid model value: the Oracle needle at commit time is already on
-- commitments.ai_probability_at_commit, so it is scored here as a member for zero calls.
--
-- Read only for the AI leaderboard; feeds no user RS/ELO/Glicko.
CREATE TABLE "ai_member_scores" (
    "id" TEXT NOT NULL,
    "prediction_id" TEXT NOT NULL,
    "commitment_id" TEXT NOT NULL,
    "model" VARCHAR(64) NOT NULL,
    "brier_score" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_member_scores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_member_scores_commitment_id_model_key" ON "ai_member_scores"("commitment_id", "model");
CREATE INDEX "ai_member_scores_model_idx" ON "ai_member_scores"("model");
CREATE INDEX "ai_member_scores_prediction_id_idx" ON "ai_member_scores"("prediction_id");

ALTER TABLE "ai_member_scores" ADD CONSTRAINT "ai_member_scores_prediction_id_fkey"
    FOREIGN KEY ("prediction_id") REFERENCES "predictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_member_scores" ADD CONSTRAINT "ai_member_scores_commitment_id_fkey"
    FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

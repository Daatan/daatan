-- daatan#2217: post-factum ("retro") forecasts. One row marks a prediction as a retro
-- simulation and carries its as-of date, outcome cutoff and recorded outcome.
CREATE TABLE "retro_simulations" (
    "prediction_id" TEXT NOT NULL,
    "as_of" TIMESTAMP(3) NOT NULL,
    "cutoff_at" TIMESTAMP(3) NOT NULL,
    "outcome" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retro_simulations_pkey" PRIMARY KEY ("prediction_id"),
    CONSTRAINT "retro_simulations_outcome_check" CHECK ("outcome" IN ('correct', 'wrong')),
    CONSTRAINT "retro_simulations_as_of_before_cutoff" CHECK ("as_of" < "cutoff_at")
);

ALTER TABLE "retro_simulations" ADD CONSTRAINT "retro_simulations_prediction_id_fkey"
    FOREIGN KEY ("prediction_id") REFERENCES "predictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Display-only card headlines for already-published forecasts. predictions.headline stays as
-- published; the card shows the newest non-revoked revision whose claim_hash matches the claim.
CREATE TABLE "prediction_headline_revisions" (
    "id" TEXT NOT NULL,
    "prediction_id" TEXT NOT NULL,
    "headline" VARCHAR(80) NOT NULL,
    "previous_headline" VARCHAR(80),
    "claim_hash" VARCHAR(64) NOT NULL,
    "reason" VARCHAR(20) NOT NULL,
    "batch" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "prediction_headline_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "prediction_headline_revisions_prediction_id_idx" ON "prediction_headline_revisions"("prediction_id");
CREATE UNIQUE INDEX "prediction_headline_revisions_prediction_id_batch_key" ON "prediction_headline_revisions"("prediction_id", "batch");

ALTER TABLE "prediction_headline_revisions" ADD CONSTRAINT "prediction_headline_revisions_prediction_id_fkey" FOREIGN KEY ("prediction_id") REFERENCES "predictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

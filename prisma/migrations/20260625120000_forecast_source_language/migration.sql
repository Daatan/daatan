-- Forecasts can be authored in any language. We now canonicalize the claim,
-- details and resolution rules to English at creation time (so the default UI
-- and the URL slug are English) and keep the author's original text as a
-- translation for its own language. `original_language` records the detected
-- source language (NULL = legacy / unknown, assumed English).
ALTER TABLE "predictions" ADD COLUMN "original_language" VARCHAR(10);

-- When a forecast is re-slugged (e.g. a non-English slug fixed during the
-- English-canonicalization backfill), its old slug is kept here so the old URL
-- 308-redirects to the current canonical slug instead of 404ing.
CREATE TABLE "prediction_slug_aliases" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "prediction_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prediction_slug_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "prediction_slug_aliases_slug_key" ON "prediction_slug_aliases"("slug");

CREATE INDEX "prediction_slug_aliases_prediction_id_idx" ON "prediction_slug_aliases"("prediction_id");

ALTER TABLE "prediction_slug_aliases" ADD CONSTRAINT "prediction_slug_aliases_prediction_id_fkey" FOREIGN KEY ("prediction_id") REFERENCES "predictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

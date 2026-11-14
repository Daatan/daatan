-- Outcome-time cutoff for predictive scoring (daatan#2144). Append-only: the newest row per
-- prediction decides; see PredictionOutcomeCutoff in schema.prisma.
CREATE TABLE "prediction_outcome_cutoffs" (
    "id" TEXT NOT NULL,
    "prediction_id" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "cutoff_at" TIMESTAMP(3),
    "basis" TEXT NOT NULL,
    "evidence_urls" TEXT[],
    "recorded_by" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prediction_outcome_cutoffs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "prediction_outcome_cutoffs_prediction_id_created_at_idx" ON "prediction_outcome_cutoffs"("prediction_id", "created_at");

ALTER TABLE "prediction_outcome_cutoffs" ADD CONSTRAINT "prediction_outcome_cutoffs_prediction_id_fkey" FOREIGN KEY ("prediction_id") REFERENCES "predictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The pundit_tag_ratings rows a recalculation replaced; see PunditTagRatingArchive.
CREATE TABLE "pundit_tag_rating_archives" (
    "id" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "scoring_version" VARCHAR(40) NOT NULL,
    "payload" JSONB NOT NULL,
    "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pundit_tag_rating_archives_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pundit_tag_rating_archives_tagId_archived_at_idx" ON "pundit_tag_rating_archives"("tagId", "archived_at");

ALTER TABLE "pundit_tag_rating_archives" ADD CONSTRAINT "pundit_tag_rating_archives_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- elections (elections.daatan.com) reads the cutoffs through the read-only `elections_ro`
-- role. Grant explicitly rather than rely on default privileges; skipped where the role
-- does not exist (local dev, CI).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'elections_ro') THEN
    GRANT SELECT ON "prediction_outcome_cutoffs" TO elections_ro;
  END IF;
END
$$;

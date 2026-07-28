-- CreateTable: per-tag ELO and Glicko-2 ratings for tracked pundits/outlets
-- (news-indexer Person, not a daatan User). Same shape as user_tag_ratings;
-- populated lazily by replaying EvidencePoolArticle stance against resolved
-- predictions for a tag (src/lib/services/pundit-rating.ts), not incrementally
-- at resolution time — pundits don't commit, so there's no resolution hook to
-- update them from.

CREATE TABLE "pundit_tag_ratings" (
  "id"                 TEXT             NOT NULL,
  "person_id"          VARCHAR(64)      NOT NULL,
  "person_name"        VARCHAR(200),
  "tagId"              TEXT             NOT NULL,
  "elo"                DOUBLE PRECISION NOT NULL DEFAULT 1500,
  "mu"                 DOUBLE PRECISION NOT NULL DEFAULT 1500,
  "sigma"              DOUBLE PRECISION NOT NULL DEFAULT 350,
  "volatility"         DOUBLE PRECISION NOT NULL DEFAULT 0.06,
  "total_predictions"  INTEGER          NOT NULL DEFAULT 0,
  "correct_predictions" INTEGER         NOT NULL DEFAULT 0,
  "updated_at"         TIMESTAMP(3)     NOT NULL,
  CONSTRAINT "pundit_tag_ratings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "pundit_tag_ratings"
  ADD CONSTRAINT "pundit_tag_ratings_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "pundit_tag_ratings_person_id_tagId_key" ON "pundit_tag_ratings"("person_id", "tagId");
CREATE INDEX "pundit_tag_ratings_tagId_idx" ON "pundit_tag_ratings"("tagId");

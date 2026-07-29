-- Open channel voting (daatan#1223 follow-up): any channel member can rate BY DESIGN,
-- so rater identity moves from a TELEGRAM_ADMIN_MAP-gated daatan User FK to the
-- tapper's Telegram user id, which every callback_query carries and which needs no
-- setup. raterUserId stays as optional enrichment (populated when the map knows the
-- Telegram id) — SET NULL on user deletion instead of cascading away the rating.
-- The map was never populated, so no feedback rows exist in prod; the backfill
-- placeholder below covers any stray row anyway rather than assuming emptiness
-- (same defensive stance as the 000003 rating-scale migration).

ALTER TABLE "evidence_pool_article_feedback" ADD COLUMN "rater_telegram_id" TEXT;
UPDATE "evidence_pool_article_feedback"
  SET "rater_telegram_id" = 'user:' || "raterUserId"
  WHERE "rater_telegram_id" IS NULL;
ALTER TABLE "evidence_pool_article_feedback" ALTER COLUMN "rater_telegram_id" SET NOT NULL;

ALTER TABLE "evidence_pool_article_feedback" ADD COLUMN "rater_name" TEXT;

ALTER TABLE "evidence_pool_article_feedback" ALTER COLUMN "raterUserId" DROP NOT NULL;
ALTER TABLE "evidence_pool_article_feedback"
  DROP CONSTRAINT "evidence_pool_article_feedback_raterUserId_fkey";
ALTER TABLE "evidence_pool_article_feedback"
  ADD CONSTRAINT "evidence_pool_article_feedback_raterUserId_fkey"
  FOREIGN KEY ("raterUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One vote per (prompt, Telegram user) replaces one vote per (prompt, daatan user).
DROP INDEX "evidence_pool_article_feedback_promptId_raterUserId_key";
CREATE UNIQUE INDEX "evidence_pool_article_feedback_promptId_rater_telegram_id_key"
  ON "evidence_pool_article_feedback"("promptId", "rater_telegram_id");

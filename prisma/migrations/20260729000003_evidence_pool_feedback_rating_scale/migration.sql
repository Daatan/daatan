-- Widen the manual number-rating feedback verdict (daatan#1223) from a binary
-- GOOD/BAD enum to a 1-5 Int scale — plain Int keeps AVG()/threshold queries
-- natural for the later analysis pass, which an enum doesn't. USING maps any
-- stray existing row (GOOD -> 5, BAD -> 1) rather than assuming the table is
-- empty, though TELEGRAM_ADMIN_MAP was never populated so none exist in prod.

ALTER TABLE "evidence_pool_article_feedback"
  ALTER COLUMN "rating" TYPE INTEGER
  USING (CASE "rating"::text WHEN 'GOOD' THEN 5 WHEN 'BAD' THEN 1 END);

DROP TYPE "NumberFeedbackRating";

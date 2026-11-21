-- daatan#2271: record where each commitment's AI probability came from, so boards that say
-- "Oracul" can count only Oracul's own estimates. Existing ai_probability_at_commit, ai_score
-- and ai_member_scores rows are left as they are; readers filter on this column instead.
ALTER TABLE "commitments" ADD COLUMN "ai_source_at_commit" VARCHAR(16);

ALTER TABLE "commitments"
  ADD CONSTRAINT "commitments_ai_source_at_commit_check"
  CHECK ("ai_source_at_commit" IS NULL OR "ai_source_at_commit" IN ('oracle', 'llm', 'unknown', 'claim_llm'));

-- Backfill by the same rule the app applies at commit time: the latest non-clock snapshot with a
-- probability at or before the stake; Oracle when it carries the Oracle payload (oracle_mean is set
-- on exactly those rows), the LLM fallback otherwise, unknown when there is no such snapshot.
-- Historical claim-only backfills cannot be told apart from 'unknown'; neither counts as Oracul.
-- About 400 rows on prod (2026-11-21), each one indexed lookup on (predictionId, createdAt).
UPDATE "commitments" c
SET "ai_source_at_commit" = COALESCE((
  SELECT CASE WHEN x."oracle_mean" IS NOT NULL THEN 'oracle' ELSE 'llm' END
  FROM "context_snapshots" x
  WHERE x."predictionId" = c."predictionId"
    AND x."kind" <> 'clock'
    AND x."external_probability" IS NOT NULL
    AND x."createdAt" <= c."createdAt"
  ORDER BY x."createdAt" DESC
  LIMIT 1
), 'unknown')
WHERE c."ai_probability_at_commit" IS NOT NULL;

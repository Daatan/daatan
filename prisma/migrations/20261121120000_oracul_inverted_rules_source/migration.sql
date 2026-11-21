-- daatan#2273: stakes graded against the Oracul's estimate of the opposite event. These
-- forecasts' resolution rules inverted their claims (#1802). Since #1430 (2026-08-11) the
-- Oracul estimates the rules, so from then on its number answered the other question. The
-- AI panel read the claim and stays valid. Relabelled rows leave every Oracul board and the
-- "vs AI" sums, because those read only 'oracle'. Their ai_probability_at_commit, ai_score and
-- ai_member_scores rows stay as they are, so a later migration can undo this one.
--   cmt1fk0xg008n01n2d66x4iyb  Ben-Gvir / Silman, resolved; its rules were never fixed.
--   cmtwpsu8r00k601p3ja2s7si4  Palestinian state, active; rules fixed 2026-10-07, but the pool
--                              kept readings of the inverted rules (#2274).
--   cmolexk3a000u01mmt8k3ou66  Ceasefire, active; same pool problem, no Oracul stakes yet.
-- No upper date bound: deploy this after the pool cleanup AND the first Oracul snapshot that
-- follows it, so every stake on the old number is covered.
ALTER TABLE "commitments" DROP CONSTRAINT "commitments_ai_source_at_commit_check";

ALTER TABLE "commitments"
  ADD CONSTRAINT "commitments_ai_source_at_commit_check"
  CHECK ("ai_source_at_commit" IS NULL OR "ai_source_at_commit" IN ('oracle', 'llm', 'unknown', 'claim_llm', 'oracle_inverted'));

UPDATE "commitments"
SET "ai_source_at_commit" = 'oracle_inverted'
WHERE "predictionId" IN ('cmt1fk0xg008n01n2d66x4iyb', 'cmtwpsu8r00k601p3ja2s7si4', 'cmolexk3a000u01mmt8k3ou66')
  AND "ai_source_at_commit" = 'oracle'
  AND "createdAt" >= '2026-08-11';

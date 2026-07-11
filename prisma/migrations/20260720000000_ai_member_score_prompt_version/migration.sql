-- Member identity is (model, mode, promptVersion) — docs/LASSO.md §6. Scores written
-- under different prompt versions are not comparable, so the leaderboard must never
-- average across them; without this column it silently did (2026-07-11 review finding).
--
-- Added while ai_member_scores is empty in every environment (verified staging + prod
-- 2026-07-11), so no backfill is needed. NULL = a sentinel member ('oracle', 'market')
-- that has no prompt. The (commitment_id, model) unique key is unchanged: a commitment
-- pins exactly one run, and a run holds one prompt_version per member.
ALTER TABLE "ai_member_scores" ADD COLUMN "prompt_version" VARCHAR(32);

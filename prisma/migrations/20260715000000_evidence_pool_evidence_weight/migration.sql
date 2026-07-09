-- Persist retro's resolved evidence_class weight per pooled article (S2
-- cutover, retro PR #249/#251; retro docs/ORACLE_VARIABLES.md, recompute-over-pool
-- step 2). Nothing reads this column yet.

ALTER TABLE "evidence_pool_articles" ADD COLUMN "evidence_weight" DOUBLE PRECISION;

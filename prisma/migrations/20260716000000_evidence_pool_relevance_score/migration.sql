-- Persist retro's graded topic relevance per pooled article (retro
-- docs/ORACLE_VARIABLES.md, recompute-over-pool step). Never previously
-- captured anywhere in daatan's pipeline. Nothing reads this column yet.

ALTER TABLE "evidence_pool_articles" ADD COLUMN "relevance_score" DOUBLE PRECISION;

-- Persist the article's most common evidence_class among its extracted
-- claims per pooled article (retro PR #255). Needed by the credibility
-- feedback loop to exclude opinion-class articles from the
-- resolution-outcome signal (docs/ORACLE_VARIABLES.md, retro #254/#255).

ALTER TABLE "evidence_pool_articles" ADD COLUMN "evidence_class" VARCHAR(32);

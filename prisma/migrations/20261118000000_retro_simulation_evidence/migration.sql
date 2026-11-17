-- daatan#2217 PR 2: the generator freezes its result on the retro row, so the page and the
-- retro source board read what Oracul said as of T0 rather than re-running it.
ALTER TABLE "retro_simulations"
  ADD COLUMN "event_text" TEXT,
  ADD COLUMN "event_date" DATE,
  ADD COLUMN "event_url" TEXT,
  ADD COLUMN "oracul_probability" DOUBLE PRECISION,
  ADD COLUMN "articles_used" INTEGER,
  ADD COLUMN "evidence" JSONB;

ALTER TABLE "retro_simulations"
  ADD CONSTRAINT "retro_simulations_oracul_probability_check"
  CHECK ("oracul_probability" IS NULL OR ("oracul_probability" >= 0 AND "oracul_probability" <= 1));

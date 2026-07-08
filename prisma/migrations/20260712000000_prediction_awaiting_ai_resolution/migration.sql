-- Symmetric AI-confidence flag for the "Awaiting Resolution" tab. Recomputed on
-- every write to `confidence` (context.ts) — true while confidence is >=90 or
-- <=10, cleared automatically once a later read lands back inside the band.
-- Does not touch `status`: an ACTIVE forecast stays ACTIVE.
ALTER TABLE "predictions" ADD COLUMN "awaiting_ai_resolution" BOOLEAN NOT NULL DEFAULT false;

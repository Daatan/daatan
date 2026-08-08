-- Schema groundwork for daatan#1267 (Phase 1 of a real versioning fix — additive
-- only, NOT wired to any read or write path yet). Re-extraction currently
-- overwrites a pool row in place (evidence-pool.ts addArticlesToPool), so a
-- correction replaces its claims instead of producing a new linked version.
-- These columns give a future version chain somewhere to land:
-- `supersedes_id` will point at the row a new version replaces once the write
-- path stops overwriting and starts inserting; `version` is a plain counter
-- defaulting to 1 for every existing and future row until something
-- increments it. Nothing reads or writes either column yet.

ALTER TABLE "evidence_pool_articles" ADD COLUMN "supersedes_id" TEXT;
ALTER TABLE "evidence_pool_articles" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "evidence_pool_articles"
  ADD CONSTRAINT "evidence_pool_articles_supersedes_id_fkey"
  FOREIGN KEY ("supersedes_id") REFERENCES "evidence_pool_articles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

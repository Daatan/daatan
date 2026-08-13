-- Write path for daatan#1267/#1352 Phase 2 (daatan#1381): a correction no
-- longer overwrites a pool row in place — it inserts a new row
-- (version = old.version + 1, supersedes_id = old.id) and stamps the old
-- row's superseded_at. (predictionId, url_hash) must now allow multiple
-- historical rows per URL, so uniqueness moves to a partial index scoped to
-- "not yet superseded".
--
-- Decided on daatan#1381 (2026-08-09, with Mark) after a first pass proposed
-- `WHERE "supersedesId" IS NULL` and got it backwards: supersedesId is a
-- BACKWARD pointer (new row -> the row it replaced), so the ORIGINAL row is
-- the one with supersedesId IS NULL, not the head. "Is the head" ("no other
-- row supersedes me") can't be expressed by a predicate over one row's own
-- columns, so it needs its own marker column instead of reusing supersedesId.
--
-- supersededAt also doubles as audit info on *when* a correction landed, for
-- free. No backfill needed: every existing row already has superseded_at
-- NULL, satisfying the same invariant the old plain unique constraint gave.
--
-- Prisma's schema DSL has no partial/filtered @@unique (prisma/prisma#1943,
-- unresolved). schema.prisma therefore declares a plain, non-unique
-- @@index([predictionId, supersededAt]) for the query planner; real
-- uniqueness enforcement lives ONLY here. `prisma migrate dev`/`db pull`
-- will show this as drift against schema.prisma — expected; do not let
-- Prisma regenerate/"fix" this migration.

ALTER TABLE "evidence_pool_articles" ADD COLUMN "superseded_at" TIMESTAMP(3);

-- The Phase-1 constraint was a plain unique INDEX (Prisma's `@@unique`
-- lowers to `CREATE UNIQUE INDEX`, not a named CONSTRAINT), added in
-- 20260714000000_evidence_pool_articles.
DROP INDEX "evidence_pool_articles_predictionId_url_hash_key";

CREATE UNIQUE INDEX "evidence_pool_articles_current_url_key"
  ON "evidence_pool_articles"("predictionId", "url_hash")
  WHERE "superseded_at" IS NULL;

-- Phase 1 (20260808010000) left the self-FK unindexed — needed for #1383's
-- chain lookups (getPoolArticleHistory) and any future orphan checks.
CREATE INDEX "evidence_pool_articles_supersedes_id_idx" ON "evidence_pool_articles"("supersedes_id");

-- Every "not yet superseded" reader (#1382) filters predictionId +
-- supersededAt together — give it a composite instead of leaning on the
-- existing predictionId-only index for that filter.
CREATE INDEX "evidence_pool_articles_predictionId_superseded_idx"
  ON "evidence_pool_articles"("predictionId", "superseded_at");

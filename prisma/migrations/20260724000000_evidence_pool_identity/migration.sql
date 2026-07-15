-- Phase 2 of the matching redesign (docs/MATCHING_ARCHITECTURE.md): persist the RESOLVED author
-- identity on each evidence-pool row (news-indexer's person resolution, delivered via
-- /articles/by-url). Lets elections attribute a source to a tracked commentator by joining on the
-- id/name instead of re-matching author strings against three hand-maintained alias tables.
-- All nullable and forward-populated on write; historical rows are backfilled separately (after
-- news-indexer's by-url identity change deploys), so no UPDATE here.
ALTER TABLE "evidence_pool_articles" ADD COLUMN "author" VARCHAR(200);
ALTER TABLE "evidence_pool_articles" ADD COLUMN "person_id" VARCHAR(64);
ALTER TABLE "evidence_pool_articles" ADD COLUMN "person_name" VARCHAR(200);

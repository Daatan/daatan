-- Phase 2 of the matching redesign (docs/MATCHING_ARCHITECTURE.md): persist the RESOLVED
-- outlet identity on each evidence-pool row (news-indexer's outlet resolution, delivered via
-- /articles/by-url), mirroring the personId/personName columns added for author identity.
-- Lets elections attribute a source to a tracked outlet by joining on the id/name instead of
-- re-matching TRACKED_SOURCES. All nullable and forward-populated on write; historical rows are
-- backfilled separately (after news-indexer's outlet-identity change deploys), so no UPDATE here.
ALTER TABLE "evidence_pool_articles" ADD COLUMN "outlet_id" VARCHAR(64);
ALTER TABLE "evidence_pool_articles" ADD COLUMN "outlet_name" VARCHAR(200);

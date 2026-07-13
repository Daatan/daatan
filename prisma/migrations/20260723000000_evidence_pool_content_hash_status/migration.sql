-- Atomic extraction-claim gate for the evidence pool (evidence-pool.ts
-- claimArticleForExtraction/completeArticleExtraction/failArticleExtraction).
-- Fixes a confirmed prod race: news-indexer's webhook delivery is
-- at-least-once, and the prior findFirst-then-create dedup in
-- saveNewsIndexerMatch let two near-simultaneous pushes for the same article
-- both pass the "not a duplicate" check before either committed, both call
-- the (non-deterministic) extractor, and both persist a ContextSnapshot (7
-- confirmed cases, 3 with conflicting stance on the same article).
--
-- contentHash: hash(title+snippet) as pushed — the only fields news-indexer's
-- webhook sends, no full article body reaches daatan. Null on existing rows;
-- treated as always-changed on next encounter, no backfill (self-heals).
--
-- status/statusReason: claim lifecycle. Existing rows default to COMPLETE —
-- they already carry real extracted stance data, not an in-flight claim.

CREATE TYPE "EvidencePoolStatus" AS ENUM ('PENDING', 'COMPLETE', 'FAILED');

ALTER TABLE "evidence_pool_articles" ADD COLUMN "content_hash" VARCHAR(64);
ALTER TABLE "evidence_pool_articles" ADD COLUMN "status" "EvidencePoolStatus" NOT NULL DEFAULT 'COMPLETE';
ALTER TABLE "evidence_pool_articles" ADD COLUMN "status_reason" VARCHAR(64);

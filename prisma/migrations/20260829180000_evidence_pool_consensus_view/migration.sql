-- daatan#1653: persist the Oracle's per-source consensus_view (retro#686, extractor v8).
-- Shadow/storage only, additive and nullable — no backfill, since pool rows are a
-- contentHash extraction cache and pre-existing rows were never extracted with it.
ALTER TABLE "evidence_pool_articles" ADD COLUMN "consensus_view" VARCHAR(16);

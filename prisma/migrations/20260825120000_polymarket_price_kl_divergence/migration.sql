-- Phase 2 of the expertise-rating plan (docs/EXPERTISE_RATING_SYSTEM.md, daatan#1138):
-- start collecting the linked market's price so a KL-divergence term can later reward
-- users who beat the Polymarket/Kalshi consensus, not just the ground truth. Matching
-- against a market ("which Polymarket market is this forecast?") is already solved by
-- the ExternalMarket link + Oracle's polymarket_market/polymarket_edge tools — this
-- migration only adds the two nullable columns to start recording data; no backfill.
--
-- commitments.polymarket_price: the linked market's YES probability (0-1,
--   polarity-adjusted) at the instant this commitment was created.
-- commitments.kl_divergence: D_KL(user || market) computed at resolution when
--   polymarket_price is present. Not wired into any ranking formula yet.
-- predictions.polymarket_price: reserved for a future denormalized "current" price
--   (mirrors ai_ci_low/ai_ci_high); no writer populates it yet.
ALTER TABLE "commitments" ADD COLUMN "polymarket_price" DOUBLE PRECISION;
ALTER TABLE "commitments" ADD COLUMN "kl_divergence" DOUBLE PRECISION;
ALTER TABLE "predictions" ADD COLUMN "polymarket_price" DOUBLE PRECISION;

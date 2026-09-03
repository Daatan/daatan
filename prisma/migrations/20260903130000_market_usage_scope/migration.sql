-- daatan#1641: structural fence for the Metaculus scope split (§6 of the market-anchor-index
-- design doc). The Bot Benchmarking Tier is under a non-commercial data-sharing agreement and
-- must never reach Oracul's production forecast path. Every existing row (all 15, all
-- human-linked or on-demand suggest) is GENERAL — none of them are Metaculus data, so the
-- default backfills correctly with no data migration needed.
CREATE TYPE "MarketUsageScope" AS ENUM ('GENERAL', 'BOT_BENCHMARKING');

ALTER TABLE "external_markets" ADD COLUMN "usage_scope" "MarketUsageScope" NOT NULL DEFAULT 'GENERAL';

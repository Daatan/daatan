-- Generalize the Polymarket-only tables into provider-agnostic external markets
-- (Polymarket + Kalshi). These tables exist only on staging (prod is tag-deploy
-- and never saw them), so renaming in place is safe.

-- Provider enum
CREATE TYPE "MarketProvider" AS ENUM ('POLYMARKET', 'KALSHI');

-- Rename tables
ALTER TABLE "polymarket_markets" RENAME TO "external_markets";
ALTER TABLE "polymarket_price_snapshots" RENAME TO "external_market_price_snapshots";

-- external_markets: columns
ALTER TABLE "external_markets" RENAME COLUMN "condition_id" TO "external_id";
ALTER TABLE "external_markets" ADD COLUMN "provider" "MarketProvider" NOT NULL DEFAULT 'POLYMARKET';
ALTER TABLE "external_markets" ADD COLUMN "url" TEXT NOT NULL DEFAULT '';
ALTER TABLE "external_markets" ADD COLUMN "embedding" vector(768);

-- Swap the single-column unique on external_id for a compound (provider, external_id)
DROP INDEX IF EXISTS "polymarket_markets_condition_id_key";
ALTER TABLE "external_markets"
  ADD CONSTRAINT "external_markets_provider_external_id_key" UNIQUE ("provider", "external_id");

-- Rename remaining indexes / constraints for Prisma naming consistency
ALTER INDEX "polymarket_markets_slug_idx" RENAME TO "external_markets_slug_idx";
ALTER TABLE "external_markets" RENAME CONSTRAINT "polymarket_markets_pkey" TO "external_markets_pkey";

ALTER INDEX "polymarket_price_snapshots_market_id_createdAt_idx"
  RENAME TO "external_market_price_snapshots_market_id_createdAt_idx";
ALTER TABLE "external_market_price_snapshots"
  RENAME CONSTRAINT "polymarket_price_snapshots_pkey" TO "external_market_price_snapshots_pkey";
ALTER TABLE "external_market_price_snapshots"
  RENAME CONSTRAINT "polymarket_price_snapshots_market_id_fkey" TO "external_market_price_snapshots_market_id_fkey";

-- predictions: rename link columns / index / FK
ALTER TABLE "predictions" RENAME COLUMN "polymarket_market_id" TO "external_market_id";
ALTER TABLE "predictions" RENAME COLUMN "polymarket_linked_at" TO "external_market_linked_at";
ALTER TABLE "predictions" RENAME COLUMN "polymarket_link_method" TO "external_market_link_method";
ALTER INDEX "predictions_polymarket_market_id_idx" RENAME TO "predictions_external_market_id_idx";
ALTER TABLE "predictions"
  RENAME CONSTRAINT "predictions_polymarket_market_id_fkey" TO "predictions_external_market_id_fkey";

-- Drop the url backfill default now that existing rows carry ''
ALTER TABLE "external_markets" ALTER COLUMN "url" DROP DEFAULT;

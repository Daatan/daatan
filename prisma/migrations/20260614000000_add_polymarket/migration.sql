-- Polymarket integration: cached external markets + price history, plus an
-- opt-in link from predictions. Only some forecasts are linked; the FK is
-- SET NULL so deleting a cached market never deletes a forecast.

-- CreateTable
CREATE TABLE "polymarket_markets" (
    "id"               TEXT NOT NULL,
    "condition_id"     TEXT NOT NULL,
    "slug"             TEXT NOT NULL,
    "question"         TEXT NOT NULL,
    "outcomes"         JSONB NOT NULL,
    "end_date"         TIMESTAMP(3),
    "resolved"         BOOLEAN NOT NULL DEFAULT false,
    "resolved_outcome" VARCHAR(100),
    "last_synced_at"   TIMESTAMP(3),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "polymarket_markets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polymarket_price_snapshots" (
    "id"          TEXT NOT NULL,
    "market_id"   TEXT NOT NULL,
    "probability" INTEGER NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "polymarket_price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "polymarket_markets_condition_id_key" ON "polymarket_markets"("condition_id");
CREATE INDEX "polymarket_markets_slug_idx" ON "polymarket_markets"("slug");
CREATE INDEX "polymarket_price_snapshots_market_id_createdAt_idx" ON "polymarket_price_snapshots"("market_id", "createdAt");

-- AlterTable
ALTER TABLE "predictions" ADD COLUMN "polymarket_market_id" TEXT;
ALTER TABLE "predictions" ADD COLUMN "polymarket_linked_at" TIMESTAMP(3);
ALTER TABLE "predictions" ADD COLUMN "polymarket_link_method" VARCHAR(20);

-- CreateIndex
CREATE INDEX "predictions_polymarket_market_id_idx" ON "predictions"("polymarket_market_id");

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_polymarket_market_id_fkey" FOREIGN KEY ("polymarket_market_id") REFERENCES "polymarket_markets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polymarket_price_snapshots" ADD CONSTRAINT "polymarket_price_snapshots_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "polymarket_markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

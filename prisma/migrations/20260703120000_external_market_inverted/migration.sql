-- Per-prediction polarity flag for the external-market link: the linked market
-- asks the opposite question, so the UI shows 100 - market price.
ALTER TABLE "predictions" ADD COLUMN "external_market_inverted" BOOLEAN NOT NULL DEFAULT false;

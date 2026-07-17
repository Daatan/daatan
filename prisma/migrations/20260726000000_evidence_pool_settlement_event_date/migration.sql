-- Persist the settlement anchor date per pooled article (retro PR #291):
-- the outcome's occurrence date for a positive settlement, the foreclosing
-- event's date for a negative one. Sent back on /pool/aggregate so retro's
-- aggregation-time settlement revalidation can re-check every stored settled
-- vote on every recompute (Phase 1 of the 2026-07-16 false-pin remediation).

ALTER TABLE "evidence_pool_articles" ADD COLUMN "settlement_event_date" TEXT;

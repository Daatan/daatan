-- Single-shot alert dedup for the market-vs-Oracle price divergence check
-- (external-market-sync cron). NULL = not currently alerted; cleared when the
-- gap closes so a later re-crossing fires again.
ALTER TABLE "predictions" ADD COLUMN "market_divergence_alert_at" TIMESTAMP(3);

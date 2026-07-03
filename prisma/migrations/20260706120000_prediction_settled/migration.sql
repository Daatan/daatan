-- Persist the Oracle's settlement flag (previously it lived only inside the
-- oracle_snapshot JSON and the Telegram alert). Sticky: writers only ever set
-- it true; human resolution supersedes it.
ALTER TABLE "predictions" ADD COLUMN "settled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "predictions" ADD COLUMN "settled_at" TIMESTAMP(3);

-- Backfill from snapshot history: a prediction is settled if its latest
-- settlement-bearing snapshot says so. Restricted to ACTIVE — resolved/void
-- rows don't need the flag and this keeps the banner off historical pages.
UPDATE "predictions" p
SET "settled" = true, "settled_at" = s."createdAt"
FROM (
  SELECT DISTINCT ON ("predictionId") "predictionId", "createdAt"
  FROM "context_snapshots"
  WHERE ("oracle_snapshot"->>'settled')::boolean IS TRUE
  ORDER BY "predictionId", "createdAt" DESC
) s
WHERE p."id" = s."predictionId" AND p."status" = 'ACTIVE';

-- Backfill the mirrors added by 20260905000000 by re-firing their trigger on every row that has
-- a snapshot. `SET oracle_snapshot = oracle_snapshot` is an UPDATE OF oracle_snapshot, so the
-- trigger derives all three columns exactly as it will for every future write — one definition,
-- not a second copy of it here. The unchanged TOAST value is not rewritten, only read.
-- 16.6k rows / ~1 GB TOAST on prod; own transaction, row locks only, readers are not blocked.
-- The read-and-derive half of this statement measured 32 s on prod (2026-09-05, 15,609 rows);
-- no statement_timeout is set for the daatan role or the migration container.
UPDATE "context_snapshots" SET oracle_snapshot = oracle_snapshot WHERE oracle_snapshot IS NOT NULL;

-- The four settled-pin lookups (predictionId, newest first) and the two
-- `contextSnapshots: { some: { oracleSettled: true } }` probes. 2,160 of 16.6k rows qualify on
-- prod. Created after the backfill so the UPDATE does not maintain it row by row.
CREATE INDEX "context_snapshots_settled_pin_idx" ON "context_snapshots" ("predictionId", "createdAt" DESC) WHERE "oracle_settled";

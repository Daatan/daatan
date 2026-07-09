-- Restore-time fix for ContextSnapshot.oracleSnapshot rows written before the
-- write-boundary conversion existed: `mean`/`std` land on the raw stance scale
-- [-1, 1] instead of probability percent [0, 100]. See docs/DATABASE.md
-- "Probability scales" and the history below. Only needed when restoring a
-- backup taken BEFORE 2026-07-08 — a live/current DB, or any backup taken on
-- or after 2026-07-08, already has every row normalized and needs nothing.
--
-- History (verified against git, not memory):
--   v1.10.0 (commit 80f304d1, 2026-04-16) introduced oracleSnapshot. From day
--   one, ciLow/ciHigh were correctly converted at write time
--   (`toPercent = (v+1)/2*100`) — they NEVER need fixing, at any row age.
--   mean/std were stored raw (bug) until commit 3016d87e ("fix: convert
--   Oracle stance mean/std to percent scale in oracleSnapshot", v1.31.2),
--   first live in production as of the v1.31.5 deploy that completed
--   2026-07-07T16:55:49Z (GitHub Actions "Deploy to Production" run for that
--   tag) — and live on staging earlier, from the v1.31.2 merge-to-main
--   deploy that completed 2026-07-07T12:33:53Z. On 2026-07-08 a one-time
--   backfill (this same formula) normalized every row already in prod, so
--   by then the raw-scale window was closed for good.
--
-- Row selection combines BOTH signals, not just one:
--   1) created_at before the relevant environment's cutoff (the real,
--      code-verified boundary — NOT a guess), AND
--   2) mean still in plausible unconverted stance range ([-1.1, 1.1], a
--      small float-slop margin around the mathematically-guaranteed
--      [-1, 1] pooled-stance range).
-- (2) is a plausibility guard against gross misuse (wrong cutoff, wrong
-- environment, a backup already past 2026-07-08) — it is NOT sufficient on
-- its own for verification, because a legitimately-converted near-0% or
-- near-100% row (from a raw mean near -1.0 or +1.0) lands right back in
-- that same band. That's why this script pins the exact row set into a
-- temp table in STEP 1 and every later step operates on that fixed id set,
-- never by re-evaluating the value predicate. Tested end-to-end against a
-- throwaway Postgres, including that exact near-boundary case.
--
-- Usage (psql, S3-presign transfer pattern — see /prod-db):
--   1. Set :'cutoff' below for the environment you're restoring (prod or
--      staging — do not mix; do not use the prod cutoff on a staging
--      restore or vice versa).
--   2. psql --single-transaction -f normalize-oracle-snapshot-scale.sql
--      --single-transaction rolls back the whole file on any error.
--   3. Read the output top to bottom: STEP 1's `rows_to_convert` count must
--      equal STEP 2's `UPDATE N` line (psql prints this automatically) must
--      equal STEP 3's `rows_converted` count. If any of the three disagree,
--      STOP and investigate before touching this backup again — do not
--      re-run the script speculatively "to be safe": a second pass would
--      re-convert the near-0%/near-100% rows STEP 3 confirmed are already
--      correct and corrupt them (see the caveat above).

-- Pick ONE cutoff for the backup you're restoring, then delete the other line.
-- psql's \set absorbs a trailing "-- comment" into the value itself — keep
-- comments on their own line, never trailing a \set line.
-- Production:
\set cutoff '2026-07-07T16:55:49Z'
-- Staging (comment out the production line above and uncomment this one):
-- \set cutoff '2026-07-07T12:33:53Z'

-- STEP 1 — identify and pin the exact row set. Everything below operates on
-- this fixed id list, not by re-evaluating the value predicate.
CREATE TEMP TABLE rows_to_fix AS
SELECT id
FROM context_snapshots
WHERE oracle_snapshot ? 'mean'
  AND "createdAt" < :'cutoff'
  AND (oracle_snapshot->>'mean')::numeric BETWEEN -1.1 AND 1.1;

SELECT count(*) AS rows_to_convert,
       min(cs."createdAt") AS oldest,
       max(cs."createdAt") AS newest
FROM context_snapshots cs
JOIN rows_to_fix r ON r.id = cs.id;

-- STEP 2 — apply, by id only. mean: (m+1)/2*100 (stanceToPercent). std: v*50
-- (stanceStdToPercent, no offset — a spread scales, it doesn't shift).
-- ciLow/ciHigh are untouched: verified correct at every row age above.
UPDATE context_snapshots cs
SET oracle_snapshot = cs.oracle_snapshot
  || jsonb_build_object(
       'mean', round((((cs.oracle_snapshot->>'mean')::numeric + 1) / 2) * 100),
       'std',  round((cs.oracle_snapshot->>'std')::numeric * 50)
     )
FROM rows_to_fix r
WHERE r.id = cs.id;

-- STEP 3 — verify by the same pinned id set, not by re-checking values.
-- Must equal STEP 1's rows_to_convert and the UPDATE N line above.
SELECT count(*) AS rows_converted
FROM context_snapshots cs
JOIN rows_to_fix r ON r.id = cs.id;

DROP TABLE rows_to_fix;

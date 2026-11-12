-- Backfill sources_delta (added by 20261112000000) for every existing evidence snapshot.
--
-- One prediction at a time, so each window sort holds one forecast's history (the largest is
-- ~150 MB of sources_summary), not the table's ~1.4 GB. Writes only sources_delta: neither
-- trigger fires (both are UPDATE OF oracle_snapshot), and the unchanged TOAST values are not
-- rewritten. Row locks only; readers are not blocked. Rows written after 20261112000000 already
-- carry a trigger-computed delta; recomputing them here gives the same value.
--
-- Same rule as the trigger: previous = same predictionId, evidence with a snapshot, ordered by
-- ("createdAt", id); the first row's delta has a null base and lists its whole pool.
DO $$
DECLARE
  pid text;
BEGIN
  FOR pid IN
    SELECT DISTINCT "predictionId" FROM "context_snapshots" WHERE kind = 'evidence' AND oracle_snapshot IS NOT NULL
  LOOP
    UPDATE "context_snapshots" c
       SET sources_delta = sources_delta_between(l.prev_id, l.prev_sources, COALESCE(c.sources_summary, '[]'::jsonb))
      FROM (
        SELECT id,
               lag(id) OVER w AS prev_id,
               lag(COALESCE(sources_summary, '[]'::jsonb)) OVER w AS prev_sources
          FROM "context_snapshots"
         WHERE "predictionId" = pid AND kind = 'evidence' AND oracle_snapshot IS NOT NULL
        WINDOW w AS (ORDER BY "createdAt", id)
      ) l
     WHERE c.id = l.id;
  END LOOP;
END
$$;

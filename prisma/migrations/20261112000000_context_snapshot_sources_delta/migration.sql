-- sources_delta: each evidence snapshot's sources_summary as a change against the previous
-- evidence snapshot of the same prediction (daatan#2158, elections#240).
--
-- Every snapshot re-lists the whole evidence pool, so sources_summary is mostly copies: on prod
-- (2026-11-12) the 34 election forecasts held 10 405 snapshots / 3.1M per-article readings /
-- 597 MB of sources_summary, which encode as 38 890 delta records / 7.6 MB. elections parsed
-- all of it on every cold build and ran its heap out (elections#237). sources_summary stays —
-- it is the keyframe a reader falls back to, and other readers use it.
--
-- Shape: { "base": <id of the previous evidence snapshot, null if none>,
--          "upsert": [records new in this snapshot or changed in any field, in its order],
--          "removed": [urls in the previous snapshot and not in this one] }
-- NULL when either pool has a reading whose url is not a string, or the same url twice (url is
-- the delta's key), and on rows that aren't evidence snapshots. The reference implementation is
-- elections' `diffSources` (src/lib/elections/history-delta.ts); the two were checked equal on
-- every election forecast on prod before this shipped.
--
-- "Previous" means exactly the reader's ordering: same predictionId, kind = 'evidence' AND
-- oracle_snapshot IS NOT NULL, ordered by ("createdAt", id). A reader uses a delta only when its
-- base is the row it just applied, and otherwise reads that row's sources_summary — so an
-- out-of-order insert, a concurrent insert, a deleted row or a row the backfill hasn't reached
-- costs a keyframe, never a wrong pool.
--
-- DDL only (metadata-only ADD COLUMN, two triggers): the ACCESS EXCLUSIVE lock is held for
-- milliseconds. 20261112000001 backfills existing rows.

ALTER TABLE "context_snapshots" ADD COLUMN "sources_delta" JSONB;

CREATE OR REPLACE FUNCTION sources_delta_between(base_id text, prev jsonb, nxt jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  WITH p AS (SELECT e, i FROM jsonb_array_elements(COALESCE(prev, '[]'::jsonb)) WITH ORDINALITY AS t(e, i)),
       n AS (SELECT e, i FROM jsonb_array_elements(COALESCE(nxt, '[]'::jsonb)) WITH ORDINALITY AS t(e, i)),
       bad AS (
         SELECT EXISTS (SELECT 1 FROM p WHERE jsonb_typeof(e -> 'url') IS DISTINCT FROM 'string')
             OR EXISTS (SELECT 1 FROM n WHERE jsonb_typeof(e -> 'url') IS DISTINCT FROM 'string')
             OR (SELECT count(*) <> count(DISTINCT e ->> 'url') FROM p)
             OR (SELECT count(*) <> count(DISTINCT e ->> 'url') FROM n) AS b)
  SELECT CASE WHEN (SELECT b FROM bad) THEN NULL ELSE jsonb_build_object(
    'base', CASE WHEN prev IS NULL THEN NULL ELSE to_jsonb(base_id) END,
    -- url is unique on both sides, so "no equal record in prev" = new url, or same url changed
    'upsert', COALESCE((SELECT jsonb_agg(n.e ORDER BY n.i) FROM n LEFT JOIN p ON p.e = n.e WHERE p.e IS NULL), '[]'::jsonb),
    'removed', COALESCE((SELECT jsonb_agg(p.e ->> 'url' ORDER BY p.i) FROM p LEFT JOIN n ON n.e ->> 'url' = p.e ->> 'url' WHERE n.e IS NULL), '[]'::jsonb))
  END
$$;

-- The existing mirrors trigger (20260905000000), plus sources_delta. Same firing rule:
-- BEFORE INSERT OR UPDATE OF oracle_snapshot.
CREATE OR REPLACE FUNCTION context_snapshot_mirrors() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prev_id text;
  prev_sources jsonb;
BEGIN
  NEW.oracle_settled := COALESCE(NEW.oracle_snapshot -> 'settled' = 'true'::jsonb, false);
  NEW.oracle_mean := CASE WHEN jsonb_typeof(NEW.oracle_snapshot -> 'mean') = 'number'
                          THEN (NEW.oracle_snapshot ->> 'mean')::float8 END;
  NEW.sources_summary := CASE WHEN jsonb_typeof(NEW.oracle_snapshot -> 'sources') = 'array'
    THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'author', s -> 'author',
        'sourceName', s -> 'sourceName',
        'stance', s -> 'stance',
        'url', s -> 'url',
        'publishedAt', s -> 'publishedAt'))
      FROM jsonb_array_elements(NEW.oracle_snapshot -> 'sources') AS s), '[]'::jsonb)
    END;

  NEW.sources_delta := NULL;
  IF NEW.kind = 'evidence' AND NEW.oracle_snapshot IS NOT NULL THEN
    SELECT c.id, COALESCE(c.sources_summary, '[]'::jsonb) INTO prev_id, prev_sources
      FROM "context_snapshots" c
     WHERE c."predictionId" = NEW."predictionId" AND c.kind = 'evidence' AND c.oracle_snapshot IS NOT NULL
       AND c.id <> NEW.id AND (c."createdAt", c.id) < (NEW."createdAt", NEW.id)
     ORDER BY c."createdAt" DESC, c.id DESC
     LIMIT 1;
    -- prev_sources stays NULL when there is no previous row: a null base, diffed against [].
    NEW.sources_delta := sources_delta_between(prev_id, prev_sources, COALESCE(NEW.sources_summary, '[]'::jsonb));
  END IF;
  RETURN NEW;
END $$;

-- Keeps the next row's delta valid when a row is inserted before it or its oracle_snapshot is
-- rewritten in place. An in-place rewrite keeps the row's id, so the reader's base check alone
-- would not notice that the successor was diffed against the old content. Writes only
-- sources_delta, which does not re-fire either trigger (both are UPDATE OF oracle_snapshot).
CREATE OR REPLACE FUNCTION context_snapshot_delta_successor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  next_id text;
BEGIN
  IF NEW.kind <> 'evidence' OR NEW.oracle_snapshot IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT c.id INTO next_id
    FROM "context_snapshots" c
   WHERE c."predictionId" = NEW."predictionId" AND c.kind = 'evidence' AND c.oracle_snapshot IS NOT NULL
     AND (c."createdAt", c.id) > (NEW."createdAt", NEW.id)
   ORDER BY c."createdAt", c.id
   LIMIT 1;
  IF next_id IS NOT NULL THEN
    UPDATE "context_snapshots"
       SET sources_delta = sources_delta_between(NEW.id, COALESCE(NEW.sources_summary, '[]'::jsonb), COALESCE(sources_summary, '[]'::jsonb))
     WHERE id = next_id;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER context_snapshot_delta_successor
  AFTER INSERT OR UPDATE OF oracle_snapshot ON "context_snapshots"
  FOR EACH ROW EXECUTE FUNCTION context_snapshot_delta_successor();

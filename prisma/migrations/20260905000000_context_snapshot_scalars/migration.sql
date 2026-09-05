-- Query audit 2026-09-05: scalar mirrors of `oracle_snapshot` so read paths stop detoasting
-- the ~1 GB column (16.6k rows on prod), plus the indexes the audit found missing.
--
-- Split in two migrations on purpose. This one is DDL only — a metadata-only ADD COLUMN on
-- pg16, a trigger, two small CREATE INDEX — so the ACCESS EXCLUSIVE lock it takes on
-- context_snapshots is held for milliseconds. 20260905000001 does the backfill in its own
-- transaction under row locks only.

ALTER TABLE "context_snapshots"
  ADD COLUMN "oracle_mean" DOUBLE PRECISION,
  ADD COLUMN "oracle_settled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sources_summary" JSONB;

-- The mirrors are derived data, so the database derives them: one BEFORE trigger instead of
-- trusting every writer to keep three columns in step with a JSON blob — `recordEstimate`
-- today, the OLD app container that keeps writing during the blue-green window this migration
-- deploys in, and ad-hoc SQL such as scripts/normalize-oracle-snapshot-scale.sql.
-- Semantics mirror the predicates they replace exactly:
--   oracle_settled  <=> oracle_snapshot -> 'settled' = true   (Prisma `path: ['settled'], equals: true`)
--   oracle_mean      =  oracle_snapshot ->> 'mean' when it is a JSON number, else NULL
--   sources_summary  =  oracle_snapshot -> 'sources' reduced to the five keys elections' chart
--                       reads ({ author, sourceName, stance, url, publishedAt }); NULL when the
--                       snapshot has no sources array, '[]' when the array is empty.
CREATE OR REPLACE FUNCTION context_snapshot_mirrors() RETURNS trigger LANGUAGE plpgsql AS $$
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
  RETURN NEW;
END $$;

CREATE TRIGGER context_snapshot_mirrors
  BEFORE INSERT OR UPDATE OF oracle_snapshot ON "context_snapshots"
  FOR EACH ROW EXECUTE FUNCTION context_snapshot_mirrors();

-- evidence_pool_articles: `getPublicArticlesByAuthorOutlet` filters (author, outlet_name) and
-- orders by added_at desc; `getPoolThroughput` counts by added_at window. Both were seq scans.
CREATE INDEX "evidence_pool_articles_author_outlet_name_added_at_idx" ON "evidence_pool_articles"("author", "outlet_name", "added_at" DESC);
CREATE INDEX "evidence_pool_articles_added_at_idx" ON "evidence_pool_articles"("added_at");

-- news_anchors_urlHash_idx duplicates the @unique key on the same column. 20260304214407
-- already dropped it, but prod still carried it on 2026-09-05 (drift), so drop it again.
DROP INDEX IF EXISTS "news_anchors_urlHash_idx";

-- Per-statement timing. The view only answers once postgres is started with
-- shared_preload_libraries=pg_stat_statements (the compose `command:` change ships separately);
-- creating the extension here means that restart is the only step left.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

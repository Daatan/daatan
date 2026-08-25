-- daatan#1617 — stepping stone toward the paired v1/v2 scoring plan
-- (Daatan/docs planning/oracle-2-relations-graph.md §8/§9). Records which
-- engine (v1/v2) and wire schema version produced a ContextSnapshot, mirroring
-- retro's Provenance.engine / Provenance.schema_version
-- (retro api/src/forecast_api/models.py).
--
-- Additive only. `engine` carries a DEFAULT, which Postgres backfills onto
-- every existing row on this ALTER (not just new inserts) — no engine other
-- than v1 has ever produced a forecast, so every pre-existing row reading
-- 'v1' is simply true, not an approximation. No write path passes 'v2' yet
-- (gated on M4/daatan#1558), so this changes nothing about current behavior.
-- `schema_version` is left NULL on existing rows on purpose: unlike "which
-- engine", "which wire schema" genuinely wasn't recorded for them.

ALTER TABLE "context_snapshots" ADD COLUMN "engine" VARCHAR(16) DEFAULT 'v1';
ALTER TABLE "context_snapshots" ADD COLUMN "schema_version" VARCHAR(16);

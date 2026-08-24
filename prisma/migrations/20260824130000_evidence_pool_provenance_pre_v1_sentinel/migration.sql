-- One-time backfill (daatan#1604/retro#627): stamp a flat "pre-v1" sentinel onto
-- extraction-provenance columns for rows that completed extraction BEFORE those
-- columns existed (migration 20260824120000). This is deliberately NOT a
-- date-inferred guess at which prompt/model actually ran a given row — Oracle's
-- SIGHUP-reload deploys and its two-checkout (live/batch) drift make a merge
-- timestamp an unreliable proxy for "which code was live" at any given moment,
-- so writing a specific historical version/hash here would risk being
-- confidently wrong. "pre-v1" only asserts "extracted before provenance capture
-- shipped" — nothing about which prompt revision.
--
-- Scoped to status = 'COMPLETE' (a stance was actually extracted) so PENDING/
-- FAILED rows, which never ran an extraction, are left untouched (NULL).
-- Idempotent: only touches rows where extractor_model IS NULL, so re-running
-- this migration (or a future one shipping the real value forward) never
-- clobbers a row that already has genuine provenance.
UPDATE "evidence_pool_articles"
SET
  "extractor_model" = 'pre-v1',
  "extractor_prompt_version" = 'pre-v1',
  "extractor_prompt_hash" = 'pre-v1',
  "gatekeeper_model" = 'pre-v1',
  "gatekeeper_prompt_version" = 'pre-v1',
  "gatekeeper_prompt_hash" = 'pre-v1'
WHERE "status" = 'COMPLETE'
  AND "extractor_model" IS NULL;

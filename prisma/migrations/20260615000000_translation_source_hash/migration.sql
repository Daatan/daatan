-- Content-aware translation cache: store the SHA-256 of the source text each
-- translation was produced from, so an edited field re-translates instead of
-- serving a stale cached translation. Existing rows get NULL → treated as stale.
ALTER TABLE "prediction_translations" ADD COLUMN "source_hash" VARCHAR(64);

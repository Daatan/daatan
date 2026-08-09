CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS predictions_claim_text_trgm_idx
  ON predictions USING gin ("claimText" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS tags_name_trgm_idx
  ON tags USING gin (name gin_trgm_ops);

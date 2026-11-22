-- daatan#2274: stamp when a forecast's claim or rules text changes, so evidence-pool rows
-- read against the old text can be found. A trigger rather than application code because
-- the text has more writers than `updateForecast` (the rules backfill, translation
-- re-derivation, the question rephrase, and hand-run fixes such as #1802's UPDATE), and a
-- stamp that misses one of them would hide exactly the pools it exists to flag.
--
-- No backfill: past edits left no history. The 11-22 cleanup (daatan#2273) already
-- excluded the rows read against the inverted rules that #1802 fixed.

ALTER TABLE "predictions" ADD COLUMN "text_changed_at" TIMESTAMP(3);

CREATE OR REPLACE FUNCTION prediction_text_changed_stamp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Prisma stores timestamps as UTC in `timestamp without time zone`.
  NEW."text_changed_at" := (now() AT TIME ZONE 'UTC');
  RETURN NEW;
END;
$$;

CREATE TRIGGER prediction_text_changed_stamp
  BEFORE UPDATE OF "claimText", "resolutionRules" ON "predictions"
  FOR EACH ROW
  WHEN (OLD."claimText" IS DISTINCT FROM NEW."claimText"
        OR OLD."resolutionRules" IS DISTINCT FROM NEW."resolutionRules")
  EXECUTE FUNCTION prediction_text_changed_stamp();

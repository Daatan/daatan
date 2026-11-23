-- Re-queue a forecast for temporal classification when its claim text or its
-- resolve-by date changes. Both are inputs to the classifier, which runs once at
-- creation; an edit left the old claim_direction / claim_deadline / claim_archetype
-- in place, and the requote clock and the Oracul republish kept reading them.
--
-- Clearing classifier_version is exactly what the requote cron's self-heal pass looks
-- for (ACTIVE + classifier_version IS NULL), so the row is reclassified before its next
-- glide. The old direction/deadline/archetype stay in place until then: they are the
-- best value available, and clearing them would stop the glide in the meantime.
--
-- A trigger rather than application code because the claim has writers beyond
-- updateForecast (the question rephrase, the English canonicalisation, hand-run SQL).
-- The classifier's own write touches neither column, so it never re-fires this.

CREATE OR REPLACE FUNCTION prediction_reclassify_on_claim_edit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."classifier_version" := NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prediction_reclassify_on_claim_edit
  BEFORE UPDATE OF "claimText", "resolveByDatetime" ON "predictions"
  FOR EACH ROW
  WHEN (OLD."claimText" IS DISTINCT FROM NEW."claimText"
        OR OLD."resolveByDatetime" IS DISTINCT FROM NEW."resolveByDatetime")
  EXECUTE FUNCTION prediction_reclassify_on_claim_edit();

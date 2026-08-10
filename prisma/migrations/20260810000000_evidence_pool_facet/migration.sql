-- Fifth fact_signal-lane facet (retro#354 D2a, retro#483): whether the dominant
-- fact-bearing claim behind fact_signal ANNOUNCES the event, DENIES it, or is
-- NEITHER. Alongside event_actors/event_target/is_occurrence/verified — same
-- SHADOW / estimator lane, same "null when fact_signal is null" convention.
--
-- Additive, nullable, no default, no backfill: populated only on NEW
-- extractions via /forecast, like the other four facets.

ALTER TABLE "evidence_pool_articles" ADD COLUMN "facet" VARCHAR(16);

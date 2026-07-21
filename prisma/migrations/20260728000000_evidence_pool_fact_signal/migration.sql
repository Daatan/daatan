-- Persist the FACT-lane signal + facets per pooled article (retro #313, Phase 2
-- of the extractor un-fusing work), surfaced on /forecast's SourceSignal:
--   fact_signal   [-1,1] — what the REPORTED FACTS alone imply about the event,
--                 separated from author assertion/framing (the fact-lane
--                 counterpart of the fused `stance`). Claim-weighted MEAN over the
--                 article's fact-bearing claims — the SAME reduction as `stance`,
--                 so the offline fact-lane backtest compares mean-to-mean.
--   event_actors  WHO acts / event_target the TARGET, from the DOMINANT
--                 (max |fact_signal|) claim — that fact's actor→target dyad (the
--                 actor-pair check, #303).
--   is_occurrence true when the dominant fact IS the event itself, false when only
--                 a precursor/precondition/escalation.
--   verified      true when independently reported, false when only claimed by an
--                 interested party.
-- All null when no scored claim carried a fact_signal (e.g. pure opinion).
--
-- SHADOW / estimator lane only — like author_lean, deliberately NOT read by any
-- estimate or aggregation, and never sent to /pool/aggregate. Additive, nullable,
-- no default, no backfill: pool rows are a contentHash extraction cache, so these
-- populate only on NEW extractions. Live `stance` and the current forecast are
-- untouched. event_actors/event_target are unbounded TEXT (no length cap) so an
-- over-long LLM value can never fail this shadow write.

ALTER TABLE "evidence_pool_articles" ADD COLUMN "fact_signal" DOUBLE PRECISION;
ALTER TABLE "evidence_pool_articles" ADD COLUMN "event_actors" TEXT;
ALTER TABLE "evidence_pool_articles" ADD COLUMN "event_target" TEXT;
ALTER TABLE "evidence_pool_articles" ADD COLUMN "is_occurrence" BOOLEAN;
ALTER TABLE "evidence_pool_articles" ADD COLUMN "verified" BOOLEAN;

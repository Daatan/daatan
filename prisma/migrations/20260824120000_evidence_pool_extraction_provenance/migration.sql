-- Persist which model/prompt produced a pool row's stance/certainty
-- (daatan#1604/retro#627) — retro's ProvenanceModels on the /forecast
-- response that wrote this row. *PromptVersion is a hand-bumped human label
-- (retro/docs/PROMPT_VERSIONS.md); *PromptHash is a SHA-256 of the actual
-- rendered prompt, computed automatically so it stays correct even when the
-- version label goes stale.
--
-- SHADOW / storage only, like `relevance_bar` — deliberately NOT read by any
-- estimate or aggregation yet. Additive, nullable, no default, no backfill:
-- pool rows are a contentHash extraction cache, so this populates only on
-- NEW extractions via /forecast; the /pool/aggregate recompute path never
-- returns model/prompt info to persist (no LLM call ran).

ALTER TABLE "evidence_pool_articles" ADD COLUMN "extractor_model" TEXT;
ALTER TABLE "evidence_pool_articles" ADD COLUMN "extractor_prompt_version" TEXT;
ALTER TABLE "evidence_pool_articles" ADD COLUMN "extractor_prompt_hash" TEXT;
ALTER TABLE "evidence_pool_articles" ADD COLUMN "gatekeeper_model" TEXT;
ALTER TABLE "evidence_pool_articles" ADD COLUMN "gatekeeper_prompt_version" TEXT;
ALTER TABLE "evidence_pool_articles" ADD COLUMN "gatekeeper_prompt_hash" TEXT;

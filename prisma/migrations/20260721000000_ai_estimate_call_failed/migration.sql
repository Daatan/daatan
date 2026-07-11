-- A null probability currently means two very different things: the model saw the claim
-- and declined ("too vague" — real signal), or the CALL failed (timeout, provider 5xx,
-- unapplied IAM) and we recorded the abstention ourselves. For an instrument whose
-- product is per-member statistics that distinction is data, not logging — day-one
-- telemetry showed DeepSeek's nulls were 100% transport failures while Grok's were 100%
-- genuine declines. Until now it was recoverable only via the latency_ms-IS-NULL proxy.
ALTER TABLE "ai_estimates" ADD COLUMN "call_failed" BOOLEAN NOT NULL DEFAULT false;

-- Backfill by the same inference the proxy used: a member that answered (even with a
-- deliberate null) always has latency recorded; a thrown call never does. Covers the
-- 116 dead gpt-5 rows and the 2026-07-10/11 provider failures.
UPDATE "ai_estimates" SET "call_failed" = true
WHERE "probability" IS NULL AND "latency_ms" IS NULL;

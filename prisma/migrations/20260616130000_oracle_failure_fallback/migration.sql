-- Instrument the Oracle fallback path: classify why a call failed/was empty and
-- attribute the LLM fallback it triggered.
--   failureReason       — timeout | network | http_5xx | http_4xx (daatan-derived)
--                         or the Oracle's own `reason` for EMPTY responses.
--   fellBackToLlm       — caller abandoned the Oracle result and used the LLM.
--   fallbackProbability — the 0–100 the LLM fallback produced.
ALTER TABLE "oracle_call_logs" ADD COLUMN "failureReason" TEXT;
ALTER TABLE "oracle_call_logs" ADD COLUMN "fellBackToLlm" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "oracle_call_logs" ADD COLUMN "fallbackProbability" INTEGER;

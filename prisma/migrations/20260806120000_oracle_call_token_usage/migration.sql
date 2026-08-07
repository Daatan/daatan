-- Persist the Oracle's LLM token usage per call (docs#57 item 3): the
-- `token_usage` object retro attaches to /forecast, /relevance and /llm
-- responses. Only FORECAST and LLM calls carry it — retro doesn't report
-- usage for SEARCH etc. — and the object is nullable/omitted when unknown,
-- so every column is NULL-able and old rows stay NULL.
ALTER TABLE "oracle_call_logs" ADD COLUMN "promptTokens" INTEGER;
ALTER TABLE "oracle_call_logs" ADD COLUMN "completionTokens" INTEGER;
ALTER TABLE "oracle_call_logs" ADD COLUMN "totalTokens" INTEGER;
ALTER TABLE "oracle_call_logs" ADD COLUMN "cacheReadTokens" INTEGER;
ALTER TABLE "oracle_call_logs" ADD COLUMN "cacheWriteTokens" INTEGER;

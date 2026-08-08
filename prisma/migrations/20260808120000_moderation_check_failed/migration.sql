-- daatan#1318: checkContent() previously fail-opened silently on any LLM error
-- (timeout, provider outage, malformed response), returning `isOffensive:
-- false` with no way to tell a real pass from a check that never ran. These
-- columns let content still publish through a transient provider error while
-- flagging it for manual admin review instead.
ALTER TABLE "predictions" ADD COLUMN "moderation_check_failed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "comments" ADD COLUMN "moderation_check_failed" BOOLEAN NOT NULL DEFAULT false;

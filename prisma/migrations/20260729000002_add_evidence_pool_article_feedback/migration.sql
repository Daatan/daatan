-- Human-in-the-loop rating of notifyNewsArticleMatched Telegram notifications
-- (daatan#1223) — a 👍/👎 verdict plus which specific number was wrong, captured via
-- a dedicated rating-prompt message's inline buttons (separate from the main
-- edited-in-place notification, since daatan#1219 made that one edit-in-place per
-- prediction rather than per article/push). article_rating_prompts is created at
-- SEND time (one row per push) so a frozen reference to what was shown survives
-- however long the message sits unrated; evidence_pool_article_feedback is created
-- lazily, one row per (prompt, rater) tap. Accumulates until there's enough signal
-- to inform edits to retro's extractor prompts (AUTHOR_LEAN/FACT_SIGNAL sections in
-- pipeline/src/tm/extractor.py). See docs/TELEGRAM_NOTIFICATIONS.md.

CREATE TYPE "NumberFeedbackRating" AS ENUM ('GOOD', 'BAD');

CREATE TYPE "NumberFeedbackField" AS ENUM (
  'STANCE',
  'RELEVANCE',
  'SIMILARITY',
  'PROBABILITY',
  'AUTHOR_LEAN',
  'FACT_SIGNAL',
  'EVIDENCE_CLASS',
  'CREDIBILITY',
  'OTHER'
);

CREATE TABLE "article_rating_prompts" (
  "id"                    TEXT             NOT NULL,
  "evidencePoolArticleId" TEXT             NOT NULL,
  "predictionId"          TEXT             NOT NULL,
  "context_snapshot_id"   TEXT,
  "snapshot_similarity"   DOUBLE PRECISION,
  "message_chat_id"       TEXT             NOT NULL,
  "message_id"            INTEGER          NOT NULL,
  "created_at"            TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "article_rating_prompts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "article_rating_prompts"
  ADD CONSTRAINT "article_rating_prompts_evidencePoolArticleId_fkey"
  FOREIGN KEY ("evidencePoolArticleId") REFERENCES "evidence_pool_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "article_rating_prompts_message_chat_id_message_id_key" ON "article_rating_prompts"("message_chat_id", "message_id");
CREATE INDEX "article_rating_prompts_evidencePoolArticleId_idx" ON "article_rating_prompts"("evidencePoolArticleId");

CREATE TABLE "evidence_pool_article_feedback" (
  "id"                    TEXT                    NOT NULL,
  "promptId"              TEXT                    NOT NULL,
  "raterUserId"           TEXT                    NOT NULL,
  "rating"                "NumberFeedbackRating"  NOT NULL,
  "flagged_fields"        "NumberFeedbackField"[] NOT NULL DEFAULT ARRAY[]::"NumberFeedbackField"[],
  "note"                  TEXT,
  "drilldown_chat_id"     TEXT,
  "drilldown_message_id"  INTEGER,
  "created_at"            TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3)            NOT NULL,
  CONSTRAINT "evidence_pool_article_feedback_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "evidence_pool_article_feedback"
  ADD CONSTRAINT "evidence_pool_article_feedback_promptId_fkey"
  FOREIGN KEY ("promptId") REFERENCES "article_rating_prompts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "evidence_pool_article_feedback"
  ADD CONSTRAINT "evidence_pool_article_feedback_raterUserId_fkey"
  FOREIGN KEY ("raterUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "evidence_pool_article_feedback_promptId_raterUserId_key" ON "evidence_pool_article_feedback"("promptId", "raterUserId");

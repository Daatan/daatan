-- The running Telegram notification for a forecast's news-article matches
-- (daatan#1215). NULL = no notification sent yet. notifyNewsArticleMatched
-- edits this message in place on a later match instead of spamming a new
-- one, falling back to a fresh send when the edit fails.
ALTER TABLE "predictions" ADD COLUMN "telegram_message_id" INTEGER;
ALTER TABLE "predictions" ADD COLUMN "telegram_chat_id" VARCHAR(64);

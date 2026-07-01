-- Drop the bot CU auto-refill columns. These were relics of the removed
-- CU-staking economy: the refill logic (ensureBotCU) is gone and nothing reads
-- these fields at runtime — they only survived in the bot admin form. There is
-- no bot balance to refill.

ALTER TABLE "bot_configs" DROP COLUMN "cuRefillAt";
ALTER TABLE "bot_configs" DROP COLUMN "cuRefillAmount";

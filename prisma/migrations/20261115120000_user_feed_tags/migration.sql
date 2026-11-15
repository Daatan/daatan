-- Remembered home-feed tag filter (daatan#2203). Additive with a default, so the old
-- blue-green slot keeps working against the migrated DB.
ALTER TABLE "users" ADD COLUMN "feed_tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- daatan#1794: slugify() dropped every non-ASCII letter, so non-Latin tag names got slug ''
-- and all of them connected to the first tag that took it. New tags use tagSlug()
-- (transliterated Cyrillic, otherwise t-<hash>); this re-slugs the rows already stuck on ''.
-- Prod has exactly one: 'Россия'. Any other '' row (staging) gets a unique md5-based slug; it
-- needn't match tagSlug()'s hash, because tag writes look an existing tag up by name first.
UPDATE "tags" SET "slug" = 'rossiya'
WHERE "slug" = '' AND "name" = 'Россия'
  AND NOT EXISTS (SELECT 1 FROM "tags" WHERE "slug" = 'rossiya');

UPDATE "tags" SET "slug" = 't-' || substr(md5("name"), 1, 8)
WHERE "slug" = '';

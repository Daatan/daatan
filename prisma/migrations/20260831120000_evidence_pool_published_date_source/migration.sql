-- daatan#1679 item 2: record where each pool row's `published_date` came from, as reported by
-- news-indexer (`article.published_at_source`, news-indexer#426): 'page' | 'feed' | 'pushed' |
-- 'url'. The date alone cannot be audited — a 2021 date read off the article page and a 2021
-- date inherited from a mislabelled feed entry are the same value with very different
-- credibility, and only one of them is worth re-extracting.
--
-- Additive and nullable, no backfill: null means "unknown", covering both rows written before
-- this column and rows whose upstream article predates the news-indexer field. Inventing a
-- source we never recorded is the exact failure this column exists to prevent.
ALTER TABLE "evidence_pool_articles" ADD COLUMN "published_date_source" VARCHAR(16);

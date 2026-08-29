-- daatan#1669 (umbrella Daatan/retro#742): stamp the Oracle build that produced each pool
-- row — retro's `provenance.oracle` {version, git_sha}. Additive and nullable, no backfill:
-- null means the row predates the stamp, the same convention as extractor_prompt_version.
ALTER TABLE "evidence_pool_articles" ADD COLUMN "oracle_version" TEXT;
ALTER TABLE "evidence_pool_articles" ADD COLUMN "oracle_git_sha" VARCHAR(40);

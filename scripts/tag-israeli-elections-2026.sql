-- One-off data change: create the "Israeli Elections 2026" tag and attach it to
-- the 8 existing forecasts approved for it (see PR for the reviewed candidate list).
--
-- Idempotent: re-running is a no-op (ON CONFLICT guards on both the tag slug and
-- the prediction↔tag join). Contains NO transaction control so the caller can
-- wrap it:
--   dry-run:  printf 'BEGIN;\n%s\nROLLBACK;\n' "$(cat this.sql)" | psql ...
--   apply:    psql --single-transaction -f this.sql ...
--
-- Tag id is a pre-generated 25-char cuid-format string (the `id` column has no DB
-- default — Prisma normally generates the cuid app-side).

-- 1) Create the tag (idempotent on the unique slug)
INSERT INTO tags (id, name, slug, "createdAt")
VALUES ('cc2xhep3uqfw7xfn328ybcty4', 'Israeli Elections 2026', 'israeli-elections-2026', now())
ON CONFLICT (slug) DO NOTHING;

-- 2) Attach the tag to the 8 approved forecasts (idempotent on the (A,B) unique index)
INSERT INTO "_PredictionToTag" ("A", "B")
SELECT p.id, t.id
FROM predictions p
JOIN tags t ON t.slug = 'israeli-elections-2026'
WHERE p.id IN (
  'cmnboexil000dickm75cvxmdm',  -- Netanyahu appointed PM following the next general election
  'cmnt0epr6004idh511bp2kfgq',  -- Likud will win the next general election in Israel
  'cmo4gh51m000y01n9jb3u60jq',  -- Netanyahu will win the 2026 Israeli general election
  'cmpcvzzey000t01ofp62kffr4',  -- Netanyahu will form the next government in Israel
  'cmqnsqfnk005j01muyxpmttpb',  -- Netanyahu will lead his party to victory in the next election
  'cmnqhj6gz000cdh517owwp0tk',  -- Netanyahu will be PM of Israel on Dec 31 2026
  'cmpy4uv91000u01qk1qolcnue',  -- Next Israeli government will not include Arab ministers
  'cmpv0250g000301mrqw9lmzxy'   -- Haredi IDF enlistment law passed by the Knesset
)
ON CONFLICT ("A", "B") DO NOTHING;

-- 3) Verify: tag + count of attached forecasts
SELECT t.name, t.slug, count(pt.*) AS attached_forecasts
FROM tags t
LEFT JOIN "_PredictionToTag" pt ON pt."B" = t.id
WHERE t.slug = 'israeli-elections-2026'
GROUP BY t.name, t.slug;

-- 4) Verify: list the attached forecasts
SELECT p.id, left(p."claimText", 70) AS claim
FROM "_PredictionToTag" pt
JOIN tags t ON t.id = pt."B"
JOIN predictions p ON p.id = pt."A"
WHERE t.slug = 'israeli-elections-2026'
ORDER BY p.id;

# Outlet profiles

The `/sources/<name>` header says who the outlet is (daatan#2345):

1. **Facts** from Wikidata: founded, country, headquarters, language, owner. Nothing about
   political alignment.
2. **One paragraph**: the lead of the outlet's Wikipedia article in the reader's language, else
   the English one. Where there is no article, a few sentences Daatan wrote from cited sources
   ("researched"), in the reader's language when every sentence has it, else English.
3. **Attribution** under both: the fact sources, then either the article link and the licence or
   the researched sources.

Code: `outletProfile()` in `src/lib/utils/outlet-profiles.ts`, data in
`src/lib/utils/outlet-profiles.json`. Lookup is by the outlet's **exact** name and then its
domains, not by `canonicalOutlet`: an alias domain such as `ynetnews.com` is a different outlet
with its own article (logos are the opposite, see [OUTLET_LOGOS.md](./OUTLET_LOGOS.md)).

## Rules

- **Wikipedia text is CC BY-SA 4.0.** Show it unmodified, never translated or shortened, with the
  article link and the licence link beside it; the JSON keeps the revision it was taken from. It
  stays out of the meta description and the JSON-LD.
- **Wikidata is CC0**, but a fact is shown only when it holds now: deprecated statements and those
  with an end time (P582) are dropped, and preferred-rank ones win when present.
- **A Wikipedia link must be the outlet's own article.** The build asserts that every lead's
  `wikibase_item` is the outlet's item; a redirect to a parent (enwiki "Ynet" → Yedioth Ahronoth)
  is dropped in `curation.json`.
- **Researched text is Daatan's own wording**, every sentence with its sources. Facts only, no
  characterisation; for a person's newsletter, only their professional role.
- **No live calls.** The page reads the bundled JSON; nothing is fetched per request.

## Regenerating

Scripts live in `scripts/outlet-profiles/` (Python 3 standard library only):

```bash
cd scripts/outlet-profiles
python3 -I collect.py outlets.json curation.json ~/raw.json      # Wikimedia APIs, ~2 min
python3 -I build.py ~/raw.json curation.json ../../src/lib/utils/outlet-profiles.json ~/review.md
```

- `outlets.json`: outlet name → Wikidata item (`null` when there is none). A new board outlet
  gets a line here.
- `curation.json`: every hand decision, each with its reason and source. `drop_extract` (a lead
  that isn't the outlet's article), `keep_only` and `omit` (facts the leads contradict or that are
  stale), `add` (a fact Wikidata lacks, cited), `researched` (the text for outlets without an
  article).
- `review.md` lists, first, every lead that characterises an outlet (state-run, left-liberal,
  far-right…) so a reviewer can read those before merge, then each outlet's facts, which paragraph
  each locale gets, and the hand decisions.

Re-collecting fetches the current Wikipedia text, so review the diff of `outlet-profiles.json`
like any other content change. A correction is a PR to `curation.json` and a rebuild.

# Generative Engine Optimization (GEO) — status and backlog

Tracks Daatan's work on visibility/citation in AI answer engines (ChatGPT, Perplexity, Google
AI Overviews, Gemini, Copilot) — distinct from traditional SEO, which is covered in
[`docs/SEO.md`](./SEO.md).

## Research basis

Findings below come from an adversarially-verified research pass (23 sources, academic +
industry, July 2026). Key takeaways that drove the backlog:

- Topic relevance and inclusion in high-ranking list/comparison content are the strongest
  confirmed citation drivers — stronger than formatting tricks.
- AI engines favor third-party earned media over brand-owned pages when selecting citations.
- Comparative listicles and tables are disproportionately cited; branded web mentions
  correlate with AI visibility more strongly than backlinks.
- Generic, blanket-rule content rewrites can help average content but *hurt* long-tail/niche
  pages — diagnostic, per-page fixes outperform uniform rules.
- Several widely-repeated vendor stats (rigid "GEO score" thresholds, Reddit/Wikipedia
  citation-share claims) did not survive adversarial fact-checking — treat vendor magic
  numbers with skepticism.
- Google's own guidance: GEO is "still SEO," rooted in the same ranking/quality systems; no
  special schema.org markup is required — crawlability/indexing is the baseline.

## Done

- **[2026-07-05] `/methodology` scoring reference page** (PR #1024) — public, worked-example
  page covering all 11 leaderboard scoring systems (Brier Score, ELO, Glicko-2 in full depth;
  the rest as a reference table). English + Hebrew (`/he/methodology`). Linked from `/about`
  footer, added to sitemap. Rationale: an evidence-dense, definition/procedure-rich page is
  exactly what drives AI-citation "absorption," and the only prior explanation lived in
  `docs/`, which `robots.txt` disallows from crawling.
- **[2026-07-05] AI-crawler diagnostic audit** (one-time, prod nginx logs, 9-day window
  2026-06-26 → 2026-07-05, 79,198 requests):
  - `robots.txt` has no AI-bot-specific blocks — crawlability baseline is fine.
  - Real crawling is happening but broad-and-thin: ClaudeBot (520 hits, ~40% robots.txt/sitemap
    checks), GPTBot (376), PerplexityBot (34, spread across many individual forecasts),
    OAI-SearchBot (61, mostly repeat robots.txt checks, little content crawl).
  - **Zero hits** from Google-Extended, Claude-SearchBot, anthropic-ai, Perplexity-User,
    Bytespider, Diffbot, Applebot-Extended.
  - **The leaderboard page got only 2 hits total in 9 days** — the page most likely to become
    a topical authority hub is currently the least-crawled. Strongest signal in the backlog for
    prioritizing item 1 below.
  - Some "AI bot" hits are spoofed vulnerability scanners (fake `ChatGPT-User`/`PerplexityBot`
    UAs probing `/app/.git/HEAD`, `/secrets.json`) — noise, not a GEO signal, ignore when
    reading future citation stats.

## Backlog (not yet implemented, roughly prioritized)

1. **Leaderboard/tag pages as topical authority hubs** — make tag pages (`/tags/[slug]`)
   comprehensive aggregators rather than thin indexes; add more internal links into the
   leaderboard, since it's currently under-crawled relative to its potential (see audit above).
2. **Auto-generated comparative listicles** — e.g. "Top 10 AI-related forecasts this month,"
   "Most contested predictions in [tag]," as their own indexable pages built from existing
   forecast data. Listicles are the single highest-leverage citation format in the research.
3. **Earn third-party mentions** — pursue distribution on forecasting-adjacent
   communities/sites (Metaculus community, Hacker News, prediction-market blogs) rather than
   only optimizing owned pages. AI engines favor earned media over brand-owned content; this is
   a distribution effort, not an on-site build.
4. **User expertise/leaderboard profile pages as evidence-dense pages** — surface track
   record, accuracy %, and notable correct calls in structured form on profile pages.
5. **Recurring diagnostic audit** — re-run the AI-crawler log audit periodically (e.g.
   quarterly) to track whether crawl behavior shifts as the above ships, rather than relying on
   the one-time 2026-07-05 snapshot indefinitely.

### Explicitly out of scope for now

- Changes to individual forecast pages (already have Answer Nugget-style facts line, JSON-LD,
  resolution criteria per `docs/SEO.md` — considered separately, not part of this backlog).
- Vendor GEO-score tools / additional schema.org markup investment — Google says it isn't
  required, and several vendor "score → citation rate" claims didn't survive fact-checking.

## Full research brief

The original research report (23 sources, verified findings, refuted claims, open questions)
is archived as a Claude artifact:
https://claude.ai/code/artifact/798a353f-330d-4a80-9bcd-30b951c1dc2b

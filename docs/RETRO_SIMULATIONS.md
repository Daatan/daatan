# Retro simulations

A retro simulation answers: **"what would the Oracul have said a week before this happened?"**
for a real event that no forecast asked about. Each one is a private forecast draft
(`source = 'retro_simulation'`) with a `retro_simulations` row that freezes the Oracul's
answer as of T0, the articles it read and the reports of the event. Approving the draft
resolves it (see [BOT_APPROVAL_WORKFLOW.md](BOT_APPROVAL_WORKFLOW.md)) and puts the event on
the public "Who foresaw X?" pages (see [Public pages](#public-pages)). The forecast itself is never
published, staked, notified or fed into user scoring or the calibration record.

Issue: [daatan#2217](https://github.com/Daatan/daatan/issues/2217). Decisions (Mark,
2026-11-16/17): the drafts feed an event-centric "Who foresaw X?" page and a retro-only source
board (PR 3 shipped the pages; the board is PR 4), never the main leaderboard; the generator runs by hand, weekly; an
event needs at least three on-topic articles published before T0 (two until 2026-11-18, see step 5); the Oracul and the page see the same
article set, after the event check (step 4) has dropped the off-topic ones.

## Pipeline

The `Retro Simulations` workflow (`.github/workflows/retro-simulations.yml`, manual dispatch
only, **dry-run by default**) calls two admin routes with the `x-cron-secret` header:

1. `POST /api/admin/retro/candidates` (`findRetroCandidates`). Writes nothing.
2. `POST /api/admin/retro/simulate` (`simulateRetroEvent`), once per candidate, largest first,
   up to `max_events`. Each call is one event check (up to 35 s; the retro judge, a smaller prompt, took 6 s median
   and 21 s at most on prod) and one Oracul analysis (up to 75 s; the 33 prod retro calls up to
   2026-11-18 took 32 s median, 38 s max); nginx allows 120 s.

The step summary lists the funnel counts, the judge's skip reasons, every candidate (with the
duplicates folded into it) and one row per simulated event: P at T0, articles used/sent, T0
and the claim, or the skip reason.

### 1. Candidates

- **Reports.** Every claim from evidence-pool rows added in the last `days` (default 7) that
  states something happened (`evidence_class = reported_fact`, `report_kind = change`,
  `verified`, not conditional) and is **not** the occurrence of the forecast it was matched to
  (`is_occurrence = false`): events next to the forecasts, not the forecasts' own outcomes.
  One report per (article, event).
- **Clusters.** The claim's forecast-relative tail is cut (`eventText`: "…, a precursor to Y"),
  the rest embedded (`gemini-embedding-2`, 768 d) and grouped by average linkage at **0.88**.
  Calibrated 2026-11-17 against the hand-reviewed 2026-11-16 simulation; the TS port reproduces
  the Python run exactly (1,085 reports → 356 clusters, 113 multi-source).
- **Filters.** At least `minSources` outlets (default 2); clusters whose articles are mostly
  (≥ 50 %) already behind a retro row are dropped; the largest `maxClusters` (default 40) go on.
- **Judge.** The `retro-event-judge` prompt (stage `retro_event_judge`, temperature 0) reads up
  to 20 reports and returns a kind (`event`, `routine`, `trend`, `not_yet`, `mixed`, `other`).
  For an event it gives the day, the report that confirms it and a future-tense claim ending in
  a literal `{DEADLINE}` token, with its resolution rules. Anything but a dated single past event
  is skipped with a reason (`not_event:<kind>`).
- **How precise the question is** (v2, #2237). The page asks who foresaw an event, so the
  question is asked at the level of detail people argued about before it: finer is a lottery
  nobody could call, coarser would have come true anyway, and either way the board stops telling
  sources apart. Never the exact day (a day set in advance becomes the occasion: "at the talks in
  Abu Dhabi"); never the exact figure (a threshold only when the line matters by itself — a
  majority, a quorum, a record — or the number was expected beforehand); the place and actors at
  the level they were argued about; the decisive act, not its packaging. A refusal that someone
  announced stays a refusal ("will decline to recommend"), but no claim may come true merely
  because nothing happened by the deadline: warnings, setbacks and talks that ended with no result
  are `other`. A repeat of a recurring kind (another prisoner swap, strike, call in a series,
  launch) or a thing nobody could see a week ahead (an earthquake, a crash) is `routine` and
  skipped, unless something distinct was known in advance — then the question is tied to that
  occasion or says "a new …", so an earlier one does not settle it. The judge sees only the
  reports, so a repeat they don't call one (a Witkoff–Putin meeting) still passes as `event`.
- **Same-event fold.** One big story splits across clusters: on 2026-11-16's pool, "Herzog
  tasked Eisenkot" came out of 8. Judged claims at cosine ≥ **0.95** (`SAME_EVENT_MIN_SCORE`) are
  folded into the member with the most outlets, and their reports are pooled. Without the fold a
  dry run would simulate each copy, because it writes nothing the later dedupe could see.

### Timeline

`retroTimeline` (in `timeline.ts`) derives every date from the judged event day and the report
dates:

| Date | Rule |
|---|---|
| `cutoffAt` | The event day, or a report up to 1 day earlier (time zones, an announcement the evening before). |
| `asOf` (T0) | The cutoff's UTC day minus 7 days. The Oracul answers as of T0. |
| evidence window | Articles published in [T0 − 45 d, T0). |
| deadline | End of the event's month; end of the next month if the event is in the month's last 3 days. |

A report dated more than a day before the event day does **not** move the cutoff. The judge saw
its date and still put the event later. Among the 22 events judged on 2026-11-17, such a report
pulled T0 back to 10–15 days before the event for 5 of them. Each case was either a wrong pool
date or a precursor fact the clustering swept in. An example of a wrong date: an aa.com.tr live
page dated 11-01 that says "tasked on 2026-11-08". The count is kept as `earlyReports`.

The event day is refused when it is empty or malformed, in the future, after the last report,
or more than 30 days before the first report (background, not this week's news).

### 2. Simulate (one event)

1. Recompute the timeline from `event.date` and the reports; the caller's preview is ignored.
2. **Dedupe.** Skip if a retro row has the same event URL, or if any prediction in any status
   (a rejected retro draft included) embeds at ≥ 0.95 to the claim. That bar is higher than
   the create form's 0.87 warning on purpose: a retro event sits next to the live forecasts its
   articles were matched to. On 22 judged claims, 0.87 would have dropped 13 real events as
   "duplicates" of the forecast they were precursors of; the closest distinct pair was 0.936.
   The up to 5 nearest predictions at ≥ 0.85 go on to the event check (step 4), which decides
   below 0.95.
3. **Evidence.** The news indexer's `POST /search/before` searches the whole index for the claim
   without its deadline clause (`evidenceQuery`: "by November 30, 2026" only dilutes the match
   to coverage written before the event; the judge's event summary is not used, because it is
   hindsight text and ranks reports of the event itself highest). It takes articles published in
   the evidence window and indexed before the cutoff, with similarity ≥ `minSimilarity` (default
   0.40; the workflow's `min_similarity` input overrides it). It returns the top 15, which is
   the Oracul's article budget. Anything dated at or after T0 is dropped again here. Fewer than
   3 articles is `thin_evidence`.

   **The floor**, hand-read on prod on 2026-11-18 (the full claim as the query, top 15 at 0.30):
   - At the first default, 0.55, 6 of 10 events found nothing.
   - Articles stayed on topic down to about 0.40.
   - Below 0.40, one event's whole set was off-topic (best 0.386: other DOJ and Nvidia
     stories). At 0.30 the Oracul still used 4 of those articles and gave 60%.
   - The pre-T0 article that already reports the event (see Known limits) sat at 0.55 or
     higher, so the floor does not stop it; the event check (step 4) does.

   It is to be rechecked with the deadline-free query.
4. **Event check** (daatan#2229). The `retro-event-check` prompt (stage `retro_event_check`,
   temperature 0, `services/retro-generator/check.ts`) gets the judge's event summary
   (hindsight, for the check only), the claim, T0, the articles found (date, outlet, title and
   up to 400 characters of snippet or text) and the nearest predictions from step 2. It answers
   per article `onTopic` and `reportsEvent`, plus `sameEventAs`: the prediction the event
   settles YES or NO, whatever its deadline. In this order:
   - `sameEventAs` set → `already_forecast` (the prediction, its status and the check's reason
     in `detail`);
   - any article `reportsEvent` → `event_before_t0` (those articles in `detail`): the
     "forecast" would have been knowledge;
   - fewer than 3 `onTopic` → `thin_evidence` (`detail.onTopic`, the off-topic titles);
   - an error, or an answer that leaves an article without a verdict →
     `event_check_failed` / `event_check_incomplete`. It fails closed: no draft.

   Only the on-topic articles go to the Oracul, so the Oracul and the public page share that
   set. Similarity can't make these calls: on 2026-11-18 the chip-rule junk scored 0.404–0.531
   and on-topic Bab el-Mandeb 0.435–0.529; same-event forecast pairs sat at 0.889–0.934 and
   distinct ones at 0.910–0.913.

   **Replay** (2026-11-18, the 13 events of that day's runs, titles only, gemini-2.5-flash):
   the chip rule (2/15 on topic) and Megaspeed (1/15) went thin; the two unity-call events
   were `event_before_t0` (3 and 5 articles); Kahana-as-Speaker and the Eisenkot-bloc Speaker
   were `already_forecast`; the 6 on-topic events kept 6–15 articles each. One more,
   "Herzog tasks Eisenkot", was `already_forecast` against "Netanyahu will be the first leader
   tasked…" (asked 2026-10-26), which the event settles NO. That is the rule as written.
5. **Oracul** answers the claim `as_of` T0 from exactly the on-topic articles. Each article always
   carries a body: the archived text, or title + snippet. Without a body the Oracul would fetch
   today's page, which may hold updates written after T0. If it uses fewer than 3 articles, the
   result is `oracul_thin`. P = (mean + 1) / 2. The bar was 2 until 2026-11-18 (daatan#2229).
   Across the three prod runs of 2026-11-17/18, the off-topic chip-rule event passed twice, each
   time with 2 used, and every on-topic, non-duplicate event used at least 3. The other
   off-topic event that got through (Megaspeed, 4 and 6 used) still passes the Oracul gate;
   the event check (step 4) now stops it.
6. **Draft** (`mode: apply` only). The draft is a `PENDING_APPROVAL` binary prediction by the
   bot user `retro_sim@daatan.internal`, `isPublic: false`. It gets a `retro_simulations` row with
   `outcome = correct` and an `evidence` JSON:
   - the search parameters;
   - the articles sent;
   - the event check (`check`): the off-topic articles dropped, the nearest predictions it was
     shown, its reason, and a note when a fallback model answered;
   - the Oracul's per-source stances and log id, and since 2026-11-18 each source's date and the
     four factors of its pooling weight (`credibilityWeight`, `evidenceWeight`, `recencyWeight`,
     `relevanceScore`) plus `isOccurrence`;
   - the reports;
   - the judge's templates;
   - the timeline.

   The claim's embedding is stored, so the next run's dedupe sees it.

## Public pages

`/who-foresaw` (the hub) lists every approved event, newest first. Each event has a page at
`/who-foresaw/<slug>`. The read side is `src/lib/services/retro-foresaw.ts`. Its query is the
visibility gate: a `retro_simulations` row, a `RESOLVED_CORRECT` or `RESOLVED_WRONG` prediction,
and generator evidence. Pending and rejected (`VOID`) drafts and every other forecast 404.

- **Indexing** (Mark, Q3). The hub is indexed and is in the sitemap; it is `noindex` while it
  has no events. Event pages are `noindex, follow` and stay out of the sitemap. Neither path is
  under `/retroanalysis`, which `robots.txt` disallows.
- **What a page shows.** The event, its date and the report that confirmed it; the Oracul's
  probability as of T0; the question it answered; and the articles the Oracul used, newest
  first. Articles are split by stance toward the event: **called it** at ≥ +0.3 in the outcome's
  direction, **said the opposite** at ≤ −0.3, **undecided** in between (Mark, 2026-11-18;
  inclusive, since many stances sit exactly on ±0.3). The event reports are listed separately as
  the confirmation, never among the pre-T0 articles.
- **Which article carried the number.** When the weight factors are stored, each article shows
  its share of the Oracul's pooling weight: credibility × evidence × recency × relevance². The
  relevance band table in retro `aggregation.relevance_weight` equals the square. The share is
  approximate: cluster down-weighting and the per-source share cap are not in the stored factors.
  The six events approved on 2026-11-18 were generated before the factors were stored, and the
  Oracul's response isn't kept anywhere else (`oracle_call_logs` holds no body), so their pages
  show a note that newer articles count more instead.
- **Self-hosted installs** 404 on both routes.

## Running it

Actions → **Retro Simulations** → `target`, `mode`, `days`, `max_clusters`, `max_events`,
`min_similarity`. Run a dry run first; it prints what would be drafted, with P at T0. The job
log carries each event's whole response (every article sent with its similarity, and the
Oracul's stance per source) for a hand-read. The workflow judges 30 clusters by default (the route's own
default is 40): 40 took 70–89 s on prod, against the 118 s limit on the candidates call. The simulate step needs the news
indexer's `/search/before` (news-indexer#542) and the app's `NEWS_INDEXER_URL` and API key.

## Known limits

- **The event day is the judge's reading.** If it puts the event later than it really
  happened, pre-T0 articles may already report it, and the "forecast" was knowledge. The event
  check skips the event when an article says so (`event_before_t0`); the approval queue still
  shows the event day, T0 and P at T0.
- **A looser paraphrase escapes the fold.** "Eisenkot will receive the mandate" scored 0.92–0.94
  against "the President will task Eisenkot", so it stays a separate draft to reject. Its
  reports stay on the rejected row, so the next run counts that cluster as covered.
- **Similarity measures topic, not the event** (daatan#2229, first apply, 2026-11-18). Off-topic
  sets score as high as on-topic ones (chip-rule junk 0.404–0.531, on-topic Bab el-Mandeb
  0.435–0.529). A forecast that already covered the event can sit below the 0.95 dedupe (0.889
  and 0.903 against "The Knesset Speaker will be changed"), while distinct pairs reach 0.913.
  The event check (step 4) handles both since daatan#2229; it is one model's reading, so the
  approval gate stays.
- **The event check shows titles and short excerpts, not whole articles.** An article whose
  title hides that it already reports the event can still get through; the approval queue
  shows the articles.
- **Runs differ.** Candidates and P are re-drawn every run (the third carrier: 75%, 67% and 81%
  in three runs), so review the drafts an apply wrote, not the dry run before it.
- **A page can look self-contradictory.** Bab el-Mandeb: 1 article called it and 8 said the
  opposite, yet the Oracul gave 66%, because the newest article (Guardian, 11-05) carried the
  most weight. The page's recency note explains it; the weight share shows it for new events.
- **Negative or trivial events.** For example, "talks will end without a breakthrough". These
  are left to the approval gate.

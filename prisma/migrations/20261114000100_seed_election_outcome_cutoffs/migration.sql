-- Outcome-time cutoffs for the 19 resolved `israeli-elections-2026` forecasts (daatan#2144).
--
-- Each cutoff is the earliest reliably verifiable public confirmation of the forecast's
-- specific outcome under its original resolution criteria — not its deadline, resolution
-- time or collection time. Where the confirming event has only a day (a list filing), the
-- cutoff is the START of the earliest possible moment, so no post-outcome reading can score.
-- Two forecasts get `insufficient`: no reliable cutoff could be established, so they keep
-- their resolution and are left out of predictive scoring. Times are UTC.
--
-- Data, not schema: rows are inserted only where the prediction exists (production), so
-- this is a no-op on dev, CI and staging databases. Append-only table — a correction is a
-- new row via POST /api/admin/forecasts/[id]/outcome-cutoff, never an edit of these.
INSERT INTO "prediction_outcome_cutoffs" ("id", "prediction_id", "status", "cutoff_at", "basis", "evidence_urls", "recorded_by")
SELECT 'cutoff_seed_' || v.pid, v.pid, v.status, v.cutoff_at, v.basis, v.urls, 'migration 20261114000100 (daatan#2144)'
FROM (VALUES
  ('cmr4kxces000o01l1xwfaxbc3', 'approved', TIMESTAMP '2026-07-15 21:00:00',
   'Deadline-based: the claim is that the Knesset is dissolved by July 15, 2026. A "did not happen by the deadline" outcome is known when the deadline passes: end of July 15 in Israel time (UTC+3).',
   ARRAY['https://daatan.com/forecasts/cmr4kxces000o01l1xwfaxbc3']),
  ('cmshi7mhn01gk01qpxx7vc5vp', 'approved', TIMESTAMP '2026-08-31 21:00:00',
   'Deadline-based: no announcement by Blue and White by the end of August 2026. Known when the deadline passes: end of August 31 in Israel time (UTC+3).',
   ARRAY['https://daatan.com/forecasts/cmshi7mhn01gk01qpxx7vc5vp']),
  ('cmqtl8kh1002301llezx64up2', 'approved', TIMESTAMP '2026-09-01 15:05:00',
   'Resolves on a party officially announcing its withdrawal, as reported by major Israeli outlets. Earliest such report in the evidence pool: Walla, 2026-09-01 15:05 UTC, followed by Srugim at 15:37 UTC.',
   ARRAY['https://news.walla.co.il/item/3864807']),
  ('cmt5k3hhg003a01mjuk4lfj7p', 'approved', TIMESTAMP '2026-09-06 21:00:00',
   'Official-filing criterion: Segalovitz appears on the list Ra''am submitted to the Central Elections Committee. Lists were filed on September 7-8, 2026; the exact filing time is not established, so the cutoff is the start of the filing window (00:00 September 7, Israel time). Earlier press reports of his joining are not the official list.',
   ARRAY['https://en.wikipedia.org/wiki/Party_lists_for_the_2026_Israeli_legislative_election', 'https://www.ynetnews.com/article/syynqz200fg']),
  ('cmqti86px000h01ll8m5hitv8', 'approved', TIMESTAMP '2026-09-06 21:00:00',
   'Official-filing criterion: Hendel registers/leads his own party''s list and appears on no pre-existing party''s list. Lists were filed on September 7-8, 2026; the exact filing time is not established, so the cutoff is the start of the filing window (00:00 September 7, Israel time).',
   ARRAY['https://en.wikipedia.org/wiki/Party_lists_for_the_2026_Israeli_legislative_election', 'https://www.ynetnews.com/article/syynqz200fg']),
  ('cmqti12av000201ll8jjrnqnd', 'approved', TIMESTAMP '2026-09-06 21:00:00',
   'Official-filing criterion: Gantz''s party officially registers to run without a joint list. Lists were filed on September 7-8, 2026; the exact filing time is not established, so the cutoff is the start of the filing window (00:00 September 7, Israel time).',
   ARRAY['https://en.wikipedia.org/wiki/Party_lists_for_the_2026_Israeli_legislative_election', 'https://www.timesofisrael.com/no-last-minute-mergers-as-parties-submit-final-knesset-slates-for-election/']),
  ('cmqtiawt7001201llxm76qt8m', 'approved', TIMESTAMP '2026-09-06 21:00:00',
   'Official-filing criterion: at least two Arab parties formally registered as a single joint list. The agreement was reported on August 19-20, but registration happens at filing; lists were filed on September 7-8, 2026 and the exact filing time is not established, so the cutoff is the start of the filing window (00:00 September 7, Israel time).',
   ARRAY['https://en.wikipedia.org/wiki/Party_lists_for_the_2026_Israeli_legislative_election', 'https://middleeasteye.net/news/three-palestinian-parties-israel-form-joint-list-ahead-elections']),
  ('cmt1fk0xg008n01n2d66x4iyb', 'approved', TIMESTAMP '2026-09-06 21:00:00',
   'Official-filing criterion: no reserved spot for Idit Silman on the Otzma Yehudit list. Otzma Yehudit submitted its list on September 7, 2026; the time of day is not established, so the cutoff is the start of that day in Israel time.',
   ARRAY['https://en.wikipedia.org/wiki/Party_lists_for_the_2026_Israeli_legislative_election']),
  ('cmt48xbl702uu01qveruev839', 'approved', TIMESTAMP '2026-09-06 21:00:00',
   'Official-filing criterion: Hanoch Milwidsky does not appear on the list Otzma Yehudit submitted to the Central Elections Committee. The list was submitted on September 7, 2026; the time of day is not established, so the cutoff is the start of that day in Israel time.',
   ARRAY['https://en.wikipedia.org/wiki/Party_lists_for_the_2026_Israeli_legislative_election']),
  ('cmraoiwcf001y01rwgcy8f4f0', 'approved', TIMESTAMP '2026-09-08 19:00:00',
   'Resolves at the final deadline for submitting candidate lists: no list with four of the six named politicians had been submitted. The deadline was 22:00 on Tuesday September 8, 2026, Israel time (UTC+3). One pre-event explainer gave September 9; Haaretz and the published lists give September 8.',
   ARRAY['https://www.haaretz.com/israel-news/elections/2026-09-08/ty-article/.premium/parties-submit-final-knesset-slates-for-israels-october-27-election/000001a0-8212-d3bd-adf3-92b331370000', 'https://www.timesofisrael.com/no-last-minute-mergers-as-parties-submit-final-knesset-slates-for-election/']),
  ('cmvcccjyc00wi01lgn1a5kzt5', 'approved', TIMESTAMP '2026-10-19 12:42:00',
   'Resolves on Gantz publicly announcing his withdrawal. Earliest reports in the evidence pool: Srugim at 2026-10-19 12:42 UTC and Amit Segal''s channel at 12:43 UTC, then the Jerusalem Post at 15:47 UTC.',
   ARRAY['https://t.me/amitsegal/65932', 'https://jpost.com/israel-election-2026/article-912167']),
  ('cmuk2y4b503n201mqv45gco6p', 'approved', TIMESTAMP '2026-10-27 18:00:00',
   'Resolves on the Central Elections Committee''s official turnout figure reaching 73%. Turnout only rises during the day; the committee''s figures were 66.7% at 18:00 and 74.3% at 20:00 Israel time (UTC+2), so the 20:00 release (18:00 UTC) is the first confirmation. The release was not verified to the minute; the earliest article carrying it is stamped 18:54 UTC, so 18:00 UTC is the conservative choice.',
   ARRAY['https://www.timesofisrael.com/liveblog-october-27-2026/', 'https://kikar.co.il/political-news/election-turnout-2025-data']),
  ('cmr4l316o001301l1h0e0ebz6', 'approved', TIMESTAMP '2026-10-28 11:00:00',
   'Earliest reliably established result, not final certification: Likud needed 34 or more seats. With 85.6% of ballots counted (reported 2026-10-28 11:00 UTC) Likud stood at about 27 seats, a margin the remaining ballots could not close. Exit polls and earlier partial counts are projections and do not qualify.',
   ARRAY['https://www.timesofisrael.com/liveblog-october-28-2026/', 'https://www.israelhayom.com/2026/10/29/israels-2026-election-results-released/']),
  ('cmttjn3h504jc01n919lub5nw', 'approved', TIMESTAMP '2026-10-28 11:00:00',
   'Earliest reliably established result, not final certification: with 85.6% of ballots counted (reported 2026-10-28 11:00 UTC) Am Yisrael stood near 1.7%, about half the 3.25% threshold, a gap the remaining ballots could not close. Exit polls and earlier partial counts do not qualify.',
   ARRAY['https://www.timesofisrael.com/liveblog-october-28-2026/', 'https://www.israelhayom.com/2026/10/29/israels-2026-election-results-released/']),
  ('cmreyz610000301oighjefvny', 'approved', TIMESTAMP '2026-10-29 16:50:00',
   'Close call that depended on the full count: whether at least two parties represented in the outgoing Knesset fell below the threshold (one finished at about 2.7% against 3.25%). Established when the Central Elections Committee completed the count, first reported 2026-10-29 16:50 UTC.',
   ARRAY['https://www.i24news.tv/en/news/israeli-elections/artc-israel-completes-vote-count-with-netanyahu-s-bloc-short-of-a-majority', 'https://www.israelhayom.com/2026/10/29/israels-2026-election-results-released/']),
  ('cmskq8dzl00a601plb2lt21dk', 'approved', TIMESTAMP '2026-10-29 16:50:00',
   'Close call that depended on the full count: whether any party exceeded 25 seats. Likud moved between 26 and 27 during the count, within reach of the line, so the result is established when the Central Elections Committee completed the count, first reported 2026-10-29 16:50 UTC.',
   ARRAY['https://www.i24news.tv/en/news/israeli-elections/artc-israel-completes-vote-count-with-netanyahu-s-bloc-short-of-a-majority', 'https://www.israelhayom.com/2026/10/29/israels-2026-election-results-released/']),
  ('cmvp6rp6j02nu01pfl5kjcu5b', 'approved', TIMESTAMP '2026-11-08 15:00:00',
   'The criterion is that another leader is FORMALLY tasked before Netanyahu. The President''s November 7 statement said he would task Eisenkot the next day, which is not the tasking itself; the recommendation count of November 5 is a preliminary indicator. The ceremony was set for 17:00 Israel time (15:00 UTC) on November 8, 2026; the earliest "officially tasked" report in the evidence pool is stamped 15:18 UTC.',
   ARRAY['https://www.president.gov.il/en/president-herzog-concludes-consultations-and-announces-he-will-task-gadi-eisenkot-with-forming-a-government/', 'https://www.timesofisrael.com/liveblog_entry/receiving-mandate-to-form-government-eisenkot-acknowledges-task-requires-creative-and-extraordinary-political-moves/']),
  ('cmshirkt001j801qp5h4b9svs', 'insufficient', NULL::timestamp,
   'Resolves on the publication of a second qualifying poll showing Yashar ahead of Likud (one with a lead of two seats or more). The resolution cites a July 20 poll and an August 14 poll, but it could not be verified that no other qualifying pair was published earlier, nor at what time the confirming poll appeared. No reliable cutoff: excluded from predictive scoring until that is established.',
   ARRAY['https://www.timesofisrael.com/eisenkot-opens-up-a-lead-on-netanyahu-in-new-toi-poll-but-both-blocs-shy-of-majority/']),
  ('cmnt0epr6004idh511bp2kfgq', 'insufficient', NULL::timestamp,
   'The original criteria resolve YES if Likud forms the governing coalition, and fall back to "largest party" only if no single party forms a government. Government formation was still open when this was recorded, so the outcome is not yet established under the original criteria (the forecast was resolved on the largest-party clause on 2026-10-30). No cutoff until a government is formed or the resolution basis is reviewed: excluded from predictive scoring.',
   ARRAY['https://daatan.com/forecasts/cmnt0epr6004idh511bp2kfgq'])
) AS v(pid, status, cutoff_at, basis, urls)
WHERE EXISTS (SELECT 1 FROM "predictions" p WHERE p."id" = v.pid)
ON CONFLICT ("id") DO NOTHING;

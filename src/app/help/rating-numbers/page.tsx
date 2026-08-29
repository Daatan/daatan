import { Gauge } from 'lucide-react'
import LegalPage from '@/components/LegalPage'
import type { Metadata } from 'next'

// Linked from the Telegram bot's article-match message (daatan#1313) — a public, no-auth
// explainer for channel members who aren't part of the team (notably Andrey). Not indexed:
// this is an internal-audience page, not marketing content (see src/app/robots.ts).
export const metadata: Metadata = {
  title: 'Reading the Oracle’s numbers — DAATAN',
  description: 'What the numbers in a DAATAN Telegram article-match message mean.',
  robots: { index: false, follow: false },
}

export default function RatingNumbersHelpPage() {
  return (
    <LegalPage title="Reading the Oracle's numbers" Icon={Gauge}>
      <section>
        <p className="text-white font-medium mb-2">In short:</p>
        <p>
          When a news article moves one of the Oracle&apos;s forecasts, DAATAN posts the movement,
          the article, and a panel of numbers explaining <em>why</em>. The 1️⃣–5️⃣ buttons ask one
          question: <strong>does this number look right, given the article?</strong>
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">The headline</h2>
        <p>
          <code className="bg-navy-800 px-1.5 py-0.5 rounded text-sm font-mono text-amber-300">
            Oracle 63% → 71%
          </code>{' '}
          is the forecast&apos;s probability before/after this article. &quot;First estimate&quot;
          = nothing to move from yet; &quot;unchanged&quot; = no shift. The suffix (e.g.
          &quot;3 new / 22 in pool&quot;) is articles-this-push vs. articles-total — one weak
          article barely moving a 22-article pool is expected, not a bug.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">The numbers panel</h2>
        <p className="mb-3">
          One row per number the article&apos;s extraction produced — a row appears only when that
          value exists. The panel is in two parts. The rows above the{' '}
          <em>not in estimate:</em> marker (<code className="bg-navy-800 px-1 rounded text-xs font-mono">stance</code>,{' '}
          <code className="bg-navy-800 px-1 rounded text-xs font-mono">relevance</code>,{' '}
          <code className="bg-navy-800 px-1 rounded text-xs font-mono">range</code>) actually feed
          the Oracle&apos;s estimate today. Everything below the marker — <strong>author_lean</strong>,{' '}
          <strong>fact_signal</strong>, <strong>credibility</strong>, <strong>class</strong>,{' '}
          <strong>consensus</strong>, <strong>report_kind</strong> — is captured and shown, but
          nothing in the estimate reads it yet: this panel is currently the only place those
          values are visible at all. That&apos;s deliberate (a &quot;shadow lane&quot;) — it lets us
          accumulate real-world numbers and eyeball them, via your ratings, before trusting any of
          them to move a forecast. When one graduates, its row moves above the marker.
        </p>
        <table className="w-full table-fixed text-xs sm:text-sm border border-navy-600 rounded-lg">
          <colgroup>
            <col className="w-[26%] sm:w-[16%]" />
            <col className="w-[16%] sm:w-[10%]" />
            <col />
          </colgroup>
          <thead>
            <tr className="bg-navy-800 text-text-secondary">
              <th className="text-left p-1.5 sm:p-2 border-b border-navy-600">Row</th>
              <th className="text-left p-1.5 sm:p-2 border-b border-navy-600">Range</th>
              <th className="text-left p-1.5 sm:p-2 border-b border-navy-600">Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">stance</td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">-1..+1</td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600">
                Which way the article argues (− = no, + = yes; 0 = genuinely balanced or unclear).{' '}
                <code className="bg-navy-800 px-1 rounded text-xs font-mono">(cert x.xx)</code> is
                the extractor&apos;s own confidence in that reading, not a second opinion — a
                low-cert stance still counts in aggregation, just noisily. <strong>Live:</strong>{' '}
                averaged into the Oracle&apos;s estimate today.
              </td>
            </tr>
            <tr>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">relevance</td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">0..1</td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600">
                How on-topic the article is <em>for this specific claim</em> — a claim-aware
                judgment, not a topic tag. <strong>Live:</strong> its <em>square</em> weights the
                article in aggregation, so 0.5 relevance counts a quarter as much as 1.0, and a
                weakly-relevant article can&apos;t move the estimate much on its own.
              </td>
            </tr>
            <tr>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">author_lean</td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">-1..+1</td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600">
                The byline author&apos;s <em>own</em> directional forecast — do they personally
                expect this to happen — separated from the facts they report. Null when the
                article only relays facts or other people&apos;s views. <strong>Shadow only:</strong>{' '}
                collected for a future per-author track record (does this author&apos;s
                lean tend to be right?); not read by the estimate.
              </td>
            </tr>
            <tr>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">fact_signal</td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">-1..+1</td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600">
                What the <em>reported facts alone</em> imply, with the author&apos;s framing and
                assertions stripped out — the &quot;just the facts&quot; counterpart to{' '}
                <code className="bg-navy-800 px-1 rounded text-xs font-mono">stance</code>.{' '}
                <strong>Shadow only:</strong> exists to let us later check whether facts and
                framing actually agree; not read by the estimate.
              </td>
            </tr>
            <tr>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">credibility</td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">≈0.5–1.5</td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600">
                An inferred credibility weight for this source/article. Only shown when it differs
                from the neutral default (1.0) — most rows omit it. <strong>Shadow only:</strong>{' '}
                a &quot;credibility cutover&quot; that would let this weight count toward the
                estimate exists but is switched off while we validate it; today it&apos;s
                display-only.
              </td>
            </tr>
            <tr>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">class</td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">5 values</td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600">
                What <em>kind</em> of evidence the article&apos;s dominant claim is:{' '}
                <code className="bg-navy-800 px-1 rounded text-xs font-mono">reported_fact</code>,{' '}
                <code className="bg-navy-800 px-1 rounded text-xs font-mono">cited_probability</code>,{' '}
                <code className="bg-navy-800 px-1 rounded text-xs font-mono">cited_share</code>{' '}
                (e.g. a poll number), <code className="bg-navy-800 px-1 rounded text-xs font-mono">reporting</code>,
                or <code className="bg-navy-800 px-1 rounded text-xs font-mono">opinion</code>.{' '}
                <strong>Shadow only:</strong> the eventual point of this field is to exclude{' '}
                <code className="bg-navy-800 px-1 rounded text-xs font-mono">opinion</code>-class
                articles from credibility scoring — an opinion piece shouldn&apos;t move a
                source&apos;s track record the way a reported fact should.
              </td>
            </tr>
            <tr>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">consensus</td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">3 values</td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600">
                What <em>this article says most people expect</em> — as distinct from what the
                author thinks (<code className="bg-navy-800 px-1 rounded text-xs font-mono">author_lean</code>):{' '}
                <code className="bg-navy-800 px-1 rounded text-xs font-mono">expects_yes</code>,{' '}
                <code className="bg-navy-800 px-1 rounded text-xs font-mono">expects_no</code> or{' '}
                <code className="bg-navy-800 px-1 rounded text-xs font-mono">divided</code>; omitted
                when the article doesn&apos;t report a consensus. <strong>Shadow only:</strong> the
                eventual use is spotting information every source shares (and so shouldn&apos;t be
                counted once per source).
              </td>
            </tr>
            <tr>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">report_kind</td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">2 values</td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600">
                Does the quoted claim report the standing <em>situation</em>{' '}
                (<code className="bg-navy-800 px-1 rounded text-xs font-mono">level</code>: &quot;the
                rate is 8.75%&quot;) or a <em>movement</em> in it{' '}
                (<code className="bg-navy-800 px-1 rounded text-xs font-mono">change</code>: &quot;the
                rate was cut&quot;)? <strong>Shadow only:</strong> a level report measures the state
                directly and should eventually reset the Oracle&apos;s recency handling rather
                than decay out of it.
              </td>
            </tr>
            <tr>
              <td className="p-1.5 sm:p-2 font-mono break-words">range</td>
              <td className="p-1.5 sm:p-2 font-mono break-words">CI %</td>
              <td className="p-1.5 sm:p-2">
                The confidence interval around the headline estimate — how much uncertainty the
                Oracle still has, not a property of this one article. Omitted when narrower than 2
                points (display noise) or when the pool doesn&apos;t have enough articles yet to
                compute one. <strong>Live:</strong> it is part of the estimate itself.
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">Rating it (1️⃣–5️⃣)</h2>
        <p className="mb-2">
          The buttons ask one question: <strong>given the article, do these numbers look
          right?</strong> 1 = clearly wrong, 5 = spot on. Tap once; tapping again changes your
          vote. Anyone in the channel can vote — there&apos;s no separate sign-up, your Telegram
          identity is the only thing recorded, and the button labels update live with how many
          people picked each score (e.g. <code className="bg-navy-800 px-1 rounded text-xs font-mono">3️⃣ ·1</code>).
        </p>
        <p>
          Votes aren&apos;t cosmetic: they land in an admin dashboard where we review the rating
          distribution and read every low vote&apos;s note. That review is what has already caught
          at least one real case of a mismatched article slipping through news-indexer&apos;s
          matching — a low rating here is a genuine bug report, not just a poll. Nothing currently
          auto-adjusts from your vote (no number moves or gets re-weighted automatically) — it
          feeds a human looking for patterns worth fixing upstream, in news-indexer&apos;s matching
          or retro&apos;s extraction.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">Rating 1 or 2: what specifically was wrong?</h2>
        <p className="mb-2">
          A rating of 1 or 2 also opens a private DM from the bot with a checklist — tap every
          field that looked off, then <strong>Done</strong>. This is what turns &quot;something&apos;s
          wrong&quot; into &quot;this specific number is wrong,&quot; which is far more useful for
          tracking down the cause. One checklist item doesn&apos;t map 1:1 to a panel row by
          name:
        </p>
        <ul className="list-disc list-inside space-y-1 mb-2">
          <li>
            <strong>Probability</strong> — the headline move at the very top of the message (the{' '}
            <code className="bg-navy-800 px-1 rounded text-xs font-mono">Oracle 63% → 71%</code>{' '}
            line and the <code className="bg-navy-800 px-1 rounded text-xs font-mono">range</code>{' '}
            row), i.e. the estimate itself rather than any one input to it.
          </li>
        </ul>
        <p>
          The rest — Stance, Relevance, Author Lean, Fact Signal, Evidence Class, Credibility — are
          the matching panel row. <strong>Other</strong> catches anything not covered above
          (including the article being matched to the wrong forecast — the old &quot;Similarity&quot;
          item; the embedding score behind that decision is no longer shown, but it is still
          recorded with your rating). The
          bot only DMs raters who&apos;ve started a chat with it before (a Telegram rule for all
          bots) — if you&apos;ve never messaged @DaatanClawBot directly, your rating still saves,
          but the drilldown prompt will ask you to <code className="bg-navy-800 px-1 rounded text-xs font-mono">/start</code>{' '}
          it and tap again to unlock the checklist. You can also just reply to either message with
          free text — it&apos;s saved as a note alongside your rating.
        </p>
      </section>
    </LegalPage>
  )
}

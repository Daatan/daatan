import { Gauge } from 'lucide-react'
import LegalPage from '@/components/LegalPage'
import type { Metadata } from 'next'

// Linked from the Telegram bot's article-match message (daatan#1313) — a public, no-auth
// explainer for channel members who aren't part of the team (notably Andrey). Not indexed:
// this is an internal-audience page, not marketing content (see src/app/robots.ts).
export const metadata: Metadata = {
  title: 'Reading the Oracle’s numbers — DAATAN',
  description: 'What the numbers in a DAATAN Telegram article-match message mean, and what the 1-5 rating is asking.',
  robots: { index: false, follow: false },
}

export default function RatingNumbersHelpPage() {
  return (
    <LegalPage title="Reading the Oracle's numbers" Icon={Gauge}>
      <section>
        <p className="text-white font-medium mb-2">In short:</p>
        <p>
          When a news article moves one of the Oracle&apos;s forecasts, DAATAN posts a message with
          the movement, the article, and a panel of numbers explaining <em>why</em> it moved. The
          1️⃣–5️⃣ buttons below the message ask one question:{' '}
          <strong>does this number look right, given the article?</strong>
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">The headline</h2>
        <p>
          <code className="bg-navy-800 px-1.5 py-0.5 rounded text-sm font-mono text-amber-300">
            Oracle 63% → 71%
          </code>{' '}
          is the forecast&apos;s probability before and after this article. &quot;First estimate&quot;
          means there was nothing to move from yet; &quot;unchanged&quot; means the article didn&apos;t
          shift the number. The suffix (e.g. &quot;3 new / 22 in pool&quot;) shows how many
          articles fed this push versus how many the Oracle has accumulated in total — one weak
          article barely moving a 22-article pool is expected, not a bug.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">The numbers panel</h2>
        <p className="mb-3">
          Every row is one number the article&apos;s extraction produced. A row is only shown when
          that value exists — an older article or a shorter panel just has fewer rows, never a
          &quot;null&quot;.
        </p>
        <div className="overflow-x-auto my-3">
          <table className="w-full text-sm border border-navy-600 rounded-lg overflow-hidden">
            <thead>
              <tr className="bg-navy-800 text-text-secondary">
                <th className="text-left p-2 border-b border-navy-600">Row</th>
                <th className="text-left p-2 border-b border-navy-600">Range</th>
                <th className="text-left p-2 border-b border-navy-600">What it means</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-2 border-b border-navy-600 font-mono whitespace-nowrap">stance</td>
                <td className="p-2 border-b border-navy-600 font-mono whitespace-nowrap">-1 .. +1</td>
                <td className="p-2 border-b border-navy-600">
                  Which way the article argues (negative = argues &quot;no&quot;, positive =
                  argues &quot;yes&quot;). The <code className="bg-navy-800 px-1 rounded text-xs font-mono">(cert x.xx)</code> alongside
                  it is how confident the extractor is in that reading, separate from the
                  article&apos;s own certainty about the underlying facts.
                </td>
              </tr>
              <tr>
                <td className="p-2 border-b border-navy-600 font-mono whitespace-nowrap">relevance</td>
                <td className="p-2 border-b border-navy-600 font-mono whitespace-nowrap">0 .. 1</td>
                <td className="p-2 border-b border-navy-600">
                  How on-topic the Oracle judged the article to be for this specific claim. Its{' '}
                  <em>square</em> weights the article in aggregation, so 0.5 relevance counts a
                  quarter as much as a fully relevant (1.0) article.
                </td>
              </tr>
              <tr>
                <td className="p-2 border-b border-navy-600 font-mono whitespace-nowrap">match</td>
                <td className="p-2 border-b border-navy-600 font-mono whitespace-nowrap">0–100%</td>
                <td className="p-2 border-b border-navy-600">
                  The embedding-similarity match between the article and the forecast&apos;s claim —
                  the mechanical, cheapest signal of the three above, and the one most prone to
                  false positives (a topically-close but substantively unrelated article can score
                  a deceptively high match).
                </td>
              </tr>
              <tr>
                <td className="p-2 border-b border-navy-600 font-mono whitespace-nowrap">
                  author_lean / fact_signal / credibility / class
                </td>
                <td className="p-2 border-b border-navy-600 font-mono whitespace-nowrap">varies</td>
                <td className="p-2 border-b border-navy-600">
                  Experimental &quot;judgment lane&quot; signals — the author&apos;s own directional
                  lean, what the reported facts alone (as opposed to the author&apos;s framing) imply,
                  an inferred credibility weight, and the article&apos;s evidence class (fact, opinion,
                  etc.). None of these currently feed the Oracle&apos;s own estimate; they&apos;re shown
                  here for early human review only.
                </td>
              </tr>
              <tr>
                <td className="p-2 font-mono whitespace-nowrap">range</td>
                <td className="p-2 font-mono whitespace-nowrap">CI %</td>
                <td className="p-2">
                  The Oracle&apos;s confidence interval around its estimate. Omitted when it&apos;s narrower
                  than 2 points — too tight to be informative at a glance.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">The 1-5 rating</h2>
        <p>
          Tapping a number is a quality check on the numbers panel above, not on the forecast
          itself: <strong>1</strong> means the numbers look clearly wrong given what the article
          actually says; <strong>5</strong> means they look right. Anyone in the channel can vote,
          and tapping again changes your previous vote. A rating of 1 or 2 opens a private message
          asking which specific number was off — see below.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">The low-rating follow-up</h2>
        <p className="mb-3">
          If you rate 1 or 2, DAATAN&apos;s bot sends you a private message with a toggle list so you
          can flag exactly what was wrong:
        </p>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>Stance</strong> — the article doesn&apos;t argue what the stance number says.</li>
          <li><strong>Relevance</strong> — the article isn&apos;t really about this claim.</li>
          <li><strong>Similarity</strong> — the match % looks too high (or too low) for how related the article actually is.</li>
          <li><strong>Probability</strong> — the Oracle&apos;s overall probability move (and its confidence interval) looks off.</li>
          <li><strong>Author Lean</strong> — the inferred author-lean number seems wrong.</li>
          <li><strong>Fact Signal</strong> — the fact-only signal (separate from the author&apos;s framing) seems wrong.</li>
          <li><strong>Evidence Class</strong> — the article was mis-classified (e.g. opinion tagged as reported fact).</li>
          <li><strong>Credibility</strong> — the inferred source-credibility weight seems wrong.</li>
          <li><strong>Other</strong> — anything else, explained via a reply to the message.</li>
        </ul>
        <p className="mt-3">
          You can toggle as many as apply, then tap <strong>Done</strong>. If the bot hasn&apos;t
          messaged you privately before, start a chat with it first (tap its name, then{' '}
          <code className="bg-navy-800 px-1.5 py-0.5 rounded text-sm font-mono text-amber-300">/start</code>) and re-tap your rating.
        </p>
      </section>

      <p className="text-text-subtle text-sm pt-2 border-t border-navy-600">
        This feedback trains future improvements to how DAATAN&apos;s Oracle reads news articles — it
        isn&apos;t visible anywhere else on the site.
      </p>
    </LegalPage>
  )
}

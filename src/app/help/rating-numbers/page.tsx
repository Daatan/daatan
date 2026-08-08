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
          value exists.
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
                Which way the article argues (− = no, + = yes). <code className="bg-navy-800 px-1 rounded text-xs font-mono">(cert x.xx)</code> is
                the extractor&apos;s confidence in that reading.
              </td>
            </tr>
            <tr>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">relevance</td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">0..1</td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600">
                How on-topic the article is for this claim. Its <em>square</em> weights it in
                aggregation — 0.5 counts a quarter as much as 1.0.
              </td>
            </tr>
            <tr>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">match</td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">0–100%</td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600">
                Embedding similarity to the claim — the cheapest, least reliable of the three; a
                topically-close but unrelated article can still score high.
              </td>
            </tr>
            <tr>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">
                author_lean / fact_signal / credibility / class
              </td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600 font-mono break-words">varies</td>
              <td className="p-1.5 sm:p-2 border-b border-navy-600">
                Experimental signals — author&apos;s lean, fact-only read, inferred credibility,
                evidence class. Not yet used in the Oracle&apos;s estimate; shown for review only.
              </td>
            </tr>
            <tr>
              <td className="p-1.5 sm:p-2 font-mono break-words">range</td>
              <td className="p-1.5 sm:p-2 font-mono break-words">CI %</td>
              <td className="p-1.5 sm:p-2">
                Confidence interval around the estimate. Omitted when narrower than 2 points.
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </LegalPage>
  )
}

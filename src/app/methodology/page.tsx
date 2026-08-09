import { Calculator } from 'lucide-react'
import Link from 'next/link'
import LegalPage from '@/components/LegalPage'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Scoring Methodology — How DAATAN Measures Forecasting Skill',
  description:
    'How DAATAN scores forecasts: Brier score, ELO rating, and Glicko-2, plus every other ranking system on the leaderboard — definitions, formulas, and worked examples.',
  alternates: {
    canonical: '/methodology',
    // Matches the hreflang shape sitemap.ts already emits for this route.
    languages: { 'x-default': '/methodology', en: '/methodology', he: '/he/methodology', ru: '/ru/methodology' },
  },
}

const BIG_THREE_ROWS = [
  { name: 'Brier Score', key: 'brierScore', sort: 'Lower is better', filter: 'Tag-filtered' },
  { name: 'ELO Rating', key: 'elo', sort: 'Higher is better', filter: 'Global + per-tag' },
  { name: 'Glicko-2', key: 'glicko', sort: 'Higher is better', filter: 'Global + per-tag' },
]

const OTHER_ROWS = [
  {
    name: 'Reputation Score (RS)',
    key: 'rs',
    what: 'The original DAATAN score. Earned by correct forecasts weighted by confidence (CU staked); wrong calls reduce it proportionally.',
    formula: 'f(confidence, outcome, pool) at resolution',
    filter: 'Global only',
  },
  {
    name: 'Accuracy',
    key: 'accuracy',
    what: 'Share of resolved forecasts that came out right.',
    formula: 'correct ÷ resolved × 100',
    filter: 'Tag-filtered',
  },
  {
    name: 'Most Correct',
    key: 'totalCorrect',
    what: 'Raw count of correct resolved forecasts.',
    formula: 'count(correct)',
    filter: 'Tag-filtered',
  },
  {
    name: 'CU Committed',
    key: 'cuCommitted',
    what: 'Total Confidence Units staked — a measure of conviction and participation volume.',
    formula: 'Σ CU staked',
    filter: 'Tag-filtered',
  },
  {
    name: 'Peer Score',
    key: 'peerScore',
    what: "How much more accurate a user's probability was than the community consensus at the moment they committed.",
    formula: '(community_p − outcome)² − (user_p − outcome)²',
    filter: 'Tag-filtered',
  },
  {
    name: 'AI Score',
    key: 'aiScore',
    what: "How much more accurate a user's probability was than DAATAN's AI estimate at commit time.",
    formula: '(ai_p − outcome)² − (user_p − outcome)²',
    filter: 'Tag-filtered',
  },
  {
    name: 'TruthScore',
    key: 'truthScore',
    what: 'Average Peer Score per forecast — how consistently a user beats the crowd, independent of volume. Requires 3+ resolved forecasts.',
    formula: 'peer_score_sum ÷ peer_score_count',
    filter: 'Tag-filtered',
  },
  {
    name: 'ROI',
    key: 'roi',
    what: 'Average net Reputation Score change per resolved forecast. Requires 3+ resolved forecasts.',
    formula: 'Σ(rs_change) ÷ count',
    filter: 'Tag-filtered',
  },
  {
    name: 'Weighted Peer Score',
    key: 'weightedPeerScore',
    what: 'Peer Score with exponential time decay, so recent forecasts count more than old ones — a pattern borrowed from Metaculus. Requires 3+ resolved forecasts.',
    formula: 'Σ(peerScore · 0.95^(days/30)) ÷ Σ(0.95^(days/30))',
    filter: 'Tag-filtered',
  },
]

export default function MethodologyPage() {
  return (
    <LegalPage title="Scoring Methodology" Icon={Calculator}>
      <section>
        <p className="text-white font-medium mb-2">In short:</p>
        <p>
          DAATAN ranks forecasters with eleven scoring systems, each measuring a different
          facet of skill: raw accuracy, calibration (Brier Score), head-to-head strength (ELO),
          and uncertainty-adjusted skill (Glicko-2) chief among them. Every system except
          Reputation Score can be filtered to a single topic via the leaderboard&apos;s{' '}
          <code className="bg-navy-800 px-1.5 py-0.5 rounded text-sm font-mono text-amber-300">
            ?tag=
          </code>{' '}
          parameter. This page defines each one, gives its formula, and works a numeric
          example end to end.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">Brier Score — calibration</h2>
        <p>
          The Brier Score measures how well a forecaster&apos;s stated confidence matches
          reality. It is the squared distance between the probability a user assigned and the
          actual outcome. Lower is better — a perfect forecaster scores{' '}
          <code className="bg-navy-800 px-1.5 py-0.5 rounded text-sm font-mono text-amber-300">
            0
          </code>
          .
        </p>
        <pre className="bg-navy-800 border border-navy-600 rounded-lg p-4 my-3 overflow-x-auto text-sm font-mono text-amber-300">
          brierScore = (probability − outcome)²
        </pre>
        <p className="text-white font-medium mb-1">Worked example</p>
        <p>
          A user commits at <strong>75% confidence</strong> that a forecast will resolve
          &quot;yes.&quot; It does.
        </p>
        <div className="overflow-x-auto my-3">
          <table className="w-full text-sm border border-navy-600 rounded-lg overflow-hidden">
            <thead>
              <tr className="bg-navy-800 text-text-secondary">
                <th className="text-left p-2 border-b border-navy-600">Outcome</th>
                <th className="text-left p-2 border-b border-navy-600">Calculation</th>
                <th className="text-left p-2 border-b border-navy-600">Brier Score</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-2 border-b border-navy-600">Resolves &quot;yes&quot; (as predicted)</td>
                <td className="p-2 border-b border-navy-600 font-mono">(0.75 − 1)²</td>
                <td className="p-2 border-b border-navy-600 font-mono">0.0625</td>
              </tr>
              <tr>
                <td className="p-2">Resolves &quot;no&quot; (against the prediction)</td>
                <td className="p-2 font-mono">(0.75 − 0)²</td>
                <td className="p-2 font-mono">0.5625</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Confident-and-wrong is penalized nine times harder than confident-and-right here —
          Brier Score punishes overconfidence quadratically, which is what forces honest use of
          the confidence slider instead of everyone claiming 99%.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">ELO Rating — head-to-head strength</h2>
        <p>
          When two users commit to the same forecast, the one with the lower Brier Score
          (closer to the truth) takes ELO from the other — the same rating system used in chess.
          Higher is better.
        </p>
        <pre className="bg-navy-800 border border-navy-600 rounded-lg p-4 my-3 overflow-x-auto text-sm font-mono text-amber-300">
{`expected_A = 1 / (1 + 10^((elo_B − elo_A) / 400))
delta_A    = K × (actual_A − expected_A)     // K = 32
actual_A   = 1 if brier_A < brier_B, 0 if worse, 0.5 if tied`}
        </pre>
        <p className="text-white font-medium mb-1">Worked example</p>
        <p>
          User A (ELO 1500) and User B (ELO 1600) both commit to the same forecast. A&apos;s
          call turns out closer to the truth.
        </p>
        <div className="overflow-x-auto my-3">
          <table className="w-full text-sm border border-navy-600 rounded-lg overflow-hidden">
            <thead>
              <tr className="bg-navy-800 text-text-secondary">
                <th className="text-left p-2 border-b border-navy-600">Step</th>
                <th className="text-left p-2 border-b border-navy-600">Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-2 border-b border-navy-600">A&apos;s expected score (as the lower-rated player)</td>
                <td className="p-2 border-b border-navy-600 font-mono">0.360</td>
              </tr>
              <tr>
                <td className="p-2 border-b border-navy-600">A wins → ELO change</td>
                <td className="p-2 border-b border-navy-600 font-mono">+20.5 → 1520.5</td>
              </tr>
              <tr>
                <td className="p-2">A loses instead → ELO change</td>
                <td className="p-2 font-mono">−11.5 → 1488.5</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Beating a higher-rated opponent earns more than beating an equally-rated one; losing
          to a higher-rated opponent costs less. ELO is stored globally on every user and,
          per-tag, in a materialized table seeded the first time a topic&apos;s leaderboard is
          requested.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">Glicko-2 — uncertainty-aware skill</h2>
        <p>
          Glicko-2 is ELO&apos;s more cautious cousin: it tracks not just a skill estimate (
          <code className="bg-navy-800 px-1.5 py-0.5 rounded text-sm font-mono text-amber-300">μ</code>
          ) but the system&apos;s <em>uncertainty</em> about that estimate (
          <code className="bg-navy-800 px-1.5 py-0.5 rounded text-sm font-mono text-amber-300">σ</code>
          ). The leaderboard ranks by{' '}
          <code className="bg-navy-800 px-1.5 py-0.5 rounded text-sm font-mono text-amber-300">
            μ − 3σ
          </code>{' '}
          — a conservative floor, not the raw estimate — so a single lucky call can never
          outrank a high-volume, consistently accurate forecaster. Every user starts at{' '}
          <code className="bg-navy-800 px-1.5 py-0.5 rounded text-sm font-mono text-amber-300">
            μ=1500, σ=350
          </code>
          .
        </p>
        <p className="text-white font-medium mb-1">Worked example</p>
        <p>
          A brand-new user (μ=1500, σ=350) makes a confident, correct forecast (Brier Score
          0.04). The system updates against a fixed social-consensus baseline:
        </p>
        <div className="overflow-x-auto my-3">
          <table className="w-full text-sm border border-navy-600 rounded-lg overflow-hidden">
            <thead>
              <tr className="bg-navy-800 text-text-secondary">
                <th className="text-left p-2 border-b border-navy-600">After</th>
                <th className="text-left p-2 border-b border-navy-600">μ</th>
                <th className="text-left p-2 border-b border-navy-600">σ</th>
                <th className="text-left p-2 border-b border-navy-600">Rank (μ − 3σ)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-2 border-b border-navy-600">1 confident correct call</td>
                <td className="p-2 border-b border-navy-600 font-mono">1649</td>
                <td className="p-2 border-b border-navy-600 font-mono">290</td>
                <td className="p-2 border-b border-navy-600 font-mono">778</td>
              </tr>
              <tr>
                <td className="p-2 border-b border-navy-600">2 confident correct calls</td>
                <td className="p-2 border-b border-navy-600 font-mono">1717</td>
                <td className="p-2 border-b border-navy-600 font-mono">256</td>
                <td className="p-2 border-b border-navy-600 font-mono">950</td>
              </tr>
              <tr>
                <td className="p-2">1 confident wrong call instead</td>
                <td className="p-2 font-mono">1399</td>
                <td className="p-2 font-mono">290</td>
                <td className="p-2 font-mono">528</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Notice the rank floor after one great call (778) is still <em>below</em> the 1500
          starting point — σ is still wide, so the system withholds trust until the pattern
          repeats. That gap closes as σ shrinks with more resolved forecasts, which is exactly
          the guarantee Glicko-2 is built to give: volume and consistency beat a single lucky
          guess. (Reference: <a href="http://www.glicko.net/glicko/glicko2.pdf" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">Glickman, 2012</a>.)
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">Every other scoring system</h2>
        <p>
          DAATAN&apos;s remaining eight systems each isolate one specific facet of forecasting
          skill — participation volume, market-beating alpha, or recency-weighted consistency.
        </p>
        <div className="overflow-x-auto my-3">
          <table className="w-full text-sm border border-navy-600 rounded-lg overflow-hidden">
            <thead>
              <tr className="bg-navy-800 text-text-secondary">
                <th className="text-left p-2 border-b border-navy-600">System</th>
                <th className="text-left p-2 border-b border-navy-600">What it measures</th>
                <th className="text-left p-2 border-b border-navy-600">Formula</th>
                <th className="text-left p-2 border-b border-navy-600">Scope</th>
              </tr>
            </thead>
            <tbody>
              {OTHER_ROWS.map((row, i) => (
                <tr key={row.key} className={i < OTHER_ROWS.length - 1 ? 'border-b border-navy-600' : ''}>
                  <td className="p-2 align-top font-medium text-white whitespace-nowrap">{row.name}</td>
                  <td className="p-2 align-top">{row.what}</td>
                  <td className="p-2 align-top font-mono whitespace-nowrap">{row.formula}</td>
                  <td className="p-2 align-top whitespace-nowrap">{row.filter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white mb-3">All eleven systems, side by side</h2>
        <div className="overflow-x-auto my-3">
          <table className="w-full text-sm border border-navy-600 rounded-lg overflow-hidden">
            <thead>
              <tr className="bg-navy-800 text-text-secondary">
                <th className="text-left p-2 border-b border-navy-600">System</th>
                <th className="text-left p-2 border-b border-navy-600">Leaderboard key</th>
                <th className="text-left p-2 border-b border-navy-600">Sort direction</th>
                <th className="text-left p-2 border-b border-navy-600">Scope</th>
              </tr>
            </thead>
            <tbody>
              {BIG_THREE_ROWS.map((row) => (
                <tr key={row.key} className="border-b border-navy-600 bg-navy-800/40">
                  <td className="p-2 font-medium text-white whitespace-nowrap">{row.name}</td>
                  <td className="p-2 font-mono whitespace-nowrap">{row.key}</td>
                  <td className="p-2 whitespace-nowrap">{row.sort}</td>
                  <td className="p-2 whitespace-nowrap">{row.filter}</td>
                </tr>
              ))}
              {OTHER_ROWS.map((row, i) => (
                <tr key={row.key} className={i < OTHER_ROWS.length - 1 ? 'border-b border-navy-600' : ''}>
                  <td className="p-2 font-medium text-white whitespace-nowrap">{row.name}</td>
                  <td className="p-2 font-mono whitespace-nowrap">{row.key}</td>
                  <td className="p-2 whitespace-nowrap">
                    {row.name === 'Reputation Score (RS)' ? 'Higher is better' : 'Higher is better'}
                  </td>
                  <td className="p-2 whitespace-nowrap">{row.filter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-text-subtle text-sm">
          Per-tag scores are computed within a single topic only — &quot;if this were the only
          subject you ever forecast, how skilled would you be?&quot; See the{' '}
          <Link href="/leaderboard" className="text-blue-400 hover:text-blue-300 underline">
            leaderboard
          </Link>{' '}
          to filter any of these by topic.
        </p>
      </section>

      <p className="text-text-subtle text-sm pt-2 border-t border-navy-600">
        Last reviewed: July 2026.
      </p>
    </LegalPage>
  )
}

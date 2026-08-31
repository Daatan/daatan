import type { Metadata } from 'next'
import { Info, Target, Users, TrendingUp, Shield, Mail, GitCommit, Zap, Github, Twitter, Lightbulb } from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { VERSION } from '@/lib/version'
import Link from 'next/link'
import { isSelfHosted } from '@/lib/edition'
import { getAppName, getContactEmail } from '@/lib/branding'
import { ensureSettingsWarmed, getCachedSetting, SETTING_KEYS } from '@/lib/services/settings'

const SELF_HOSTED = isSelfHosted()

export async function generateMetadata(): Promise<Metadata> {
  if (SELF_HOSTED) {
    await ensureSettingsWarmed()
    const title = getCachedSetting(SETTING_KEYS.aboutTitle) || `About ${getAppName()}`
    return { title, alternates: { canonical: '/about' }, openGraph: { url: '/about', type: 'website' } }
  }
  // SaaS — byte-identical to the previous static metadata.
  return {
    title: 'How DAATAN Works — Forecast Tracking & Prediction Market',
    description: 'Learn how DAATAN works — a forecast tracking platform where you make predictions, stake your reputation, track your Brier score, and build your credibility over time.',
    alternates: { canonical: '/about' },
    openGraph: { url: '/about', type: 'website' },
  }
}

// Markdown element styling for the dark theme (the app has no Tailwind
// typography plugin). `node` is stripped so it never lands on a DOM element.
// jsx-a11y can't see that `{...p}` always carries markdown-parsed children,
// so heading/anchor content checks false-positive here — disabled below.
/* eslint-disable jsx-a11y/heading-has-content, jsx-a11y/anchor-has-content */
const mdComponents: Components = {
  h1: ({ node, ...p }) => <h1 className="text-2xl font-bold text-white mt-6 mb-3 first:mt-0" {...p} />,
  h2: ({ node, ...p }) => <h2 className="text-xl font-bold text-white mt-5 mb-2" {...p} />,
  h3: ({ node, ...p }) => <h3 className="text-lg font-semibold text-white mt-4 mb-2" {...p} />,
  p: ({ node, ...p }) => <p className="text-text-secondary mb-3 leading-relaxed" {...p} />,
  ul: ({ node, ...p }) => <ul className="list-disc pl-6 mb-3 text-text-secondary space-y-1" {...p} />,
  ol: ({ node, ...p }) => <ol className="list-decimal pl-6 mb-3 text-text-secondary space-y-1" {...p} />,
  a: ({ node, ...p }) => <a className="text-blue-400 hover:text-blue-300 underline" target="_blank" rel="noopener noreferrer" {...p} />,
  strong: ({ node, ...p }) => <strong className="font-semibold text-white" {...p} />,
  em: ({ node, ...p }) => <em className="italic" {...p} />,
  code: ({ node, ...p }) => <code className="bg-navy-800 px-1.5 py-0.5 rounded text-sm font-mono text-amber-300" {...p} />,
  blockquote: ({ node, ...p }) => <blockquote className="border-l-4 border-navy-600 pl-4 italic text-gray-400 my-3" {...p} />,
  hr: ({ node, ...p }) => <hr className="border-navy-600 my-5" {...p} />,
}

/**
 * On the self-hosted edition /about renders the admin-authored title + Markdown
 * body (Admin → Settings); SaaS keeps the original DAATAN marketing page.
 */
export default async function AboutPage() {
  if (SELF_HOSTED) return <SelfHostAboutPage />
  return <SaasAboutPage />
}

async function SelfHostAboutPage() {
  await ensureSettingsWarmed()
  const appName = getAppName()
  const title = getCachedSetting(SETTING_KEYS.aboutTitle) || `About ${appName}`
  const body = getCachedSetting(SETTING_KEYS.aboutBody)
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6 lg:mb-8">
        <Info className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500" />
        <h1 className="text-2xl sm:text-3xl font-bold text-white">{title}</h1>
      </div>
      {body ? (
        <div className="bg-navy-700 border border-navy-600 rounded-xl p-6">
          <ReactMarkdown components={mdComponents}>{body}</ReactMarkdown>
        </div>
      ) : (
        <div className="bg-navy-800 border border-cobalt/30 rounded-xl p-6 text-text-secondary">
          {appName} is an internal forecasting platform. An administrator can customize this page under Admin → Settings.
        </div>
      )}
    </div>
  )
}

function SaasAboutPage() {
  const gitCommit = process.env.GIT_COMMIT || null
  const commitShort = gitCommit ? gitCommit.substring(0, 7) : null
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6 lg:mb-8">
        <Info className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500" />
        <h1 className="text-2xl sm:text-3xl font-bold text-white">About DAATAN</h1>
      </div>

      {/* Tagline */}
      <div className="bg-navy-800 border border-cobalt/30 rounded-xl p-6 mb-6">
        <p className="text-lg sm:text-xl font-semibold text-white mb-2">
          Prove you were right — without shouting into the void.
        </p>
        <p className="text-sm text-text-secondary">
          DAATAN is a forecast tracking platform where you can make forecasts, track your accuracy, and build your credibility over time.
        </p>
      </div>

      {/* Why DAATAN? */}
      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Why DAATAN?</h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-amber-900/20 text-amber-600 rounded-lg shrink-0">
              <Lightbulb className="w-5 h-5" />
            </div>
            <div>
              <p className="font-medium text-white">Turn Predictions Into Accountability</p>
              <p className="text-sm text-text-secondary">
                Gut feelings are cheap. Real predictions force you to think deeply, quantify uncertainty, and get specific about timelines. DAATAN holds you accountable.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="p-2 bg-cobalt/10 text-cobalt-light rounded-lg shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <p className="font-medium text-white">Build Real Credibility</p>
              <p className="text-sm text-text-secondary">
                Track your accuracy in real-time. A strong prediction track record speaks louder than credentials in many domains.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="p-2 bg-teal/10 text-teal rounded-lg shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <p className="font-medium text-white">Learn From a Community</p>
              <p className="text-sm text-text-secondary">
                See how others think about the same questions. Discover blind spots, sharpen your judgment, and grow with a community of forecasters.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">How It Works</h2>
        </div>
        <div className="p-6 space-y-5">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-cobalt/10 text-cobalt-light rounded-lg shrink-0">
              <Target className="w-5 h-5" />
            </div>
            <div>
              <p className="font-medium text-white">Make Predictions</p>
              <p className="text-sm text-text-secondary">
                Create forecasts about future events with specific deadlines and resolution criteria.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="p-2 bg-teal/10 text-teal rounded-lg shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <p className="font-medium text-white">Community Engagement</p>
              <p className="text-sm text-text-secondary">
                Browse the feed, vote on predictions, and see what others think will happen.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="p-2 bg-amber-900/20 text-amber-600 rounded-lg shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <p className="font-medium text-white">Track Your Accuracy</p>
              <p className="text-sm text-text-secondary">
                Build your track record with a verifiable history of predictions. Your Reputation Score and Brier Skill Score update automatically after each resolution.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="p-2 bg-purple-900/20 text-cobalt-light rounded-lg shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <p className="font-medium text-white">Fair Resolution</p>
              <p className="text-sm text-text-secondary">
                Predictions are resolved by trusted resolvers based on transparent criteria you define upfront.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Scoring System */}
      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">How Scoring Works</h2>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <h3 className="font-medium text-white mb-2 flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-500" />
              Reputation Score (RS)
            </h3>
            <p className="text-sm text-text-secondary mb-3">
              Your Reputation Score is your long-term credibility metric. It updates after each resolved prediction, weighted by your confidence and the outcome.
            </p>
            <ul className="text-sm text-text-secondary space-y-1 ml-4">
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-1">•</span>
                <span><strong>Earned through accuracy:</strong> RS rises with correct calls, falls with wrong ones</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-1">•</span>
                <span><strong>Can be negative:</strong> A poor track record results in negative RS</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-1">•</span>
                <span><strong>Global:</strong> RS is a single score across all topics — use the leaderboard&apos;s tag filter to compare forecasters within a specific domain</span>
              </li>
            </ul>
          </div>

          <div className="pt-4 border-t border-navy-600">
            <h3 className="font-medium text-white mb-2 flex items-center gap-2">
              <Target className="w-4 h-4 text-amber-500" />
              Brier Skill Score (BSS)
            </h3>
            <p className="text-sm text-text-secondary mb-3">
              The BSS measures calibration — how well your stated confidence matches reality across all your forecasts. A perfectly calibrated forecaster scores 1.0; random guessing scores 0.
            </p>
            <ul className="text-sm text-text-secondary space-y-1 ml-4">
              <li className="flex items-start gap-2">
                <span className="text-amber-500 mt-1">•</span>
                <span><strong>Calibration over accuracy:</strong> Saying &quot;70% likely&quot; and being right 70% of the time is better than always saying 100%</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 mt-1">•</span>
                <span><strong>Only on resolved forecasts:</strong> BSS updates automatically when a prediction is resolved</span>
              </li>
            </ul>
          </div>

          <div className="pt-4 border-t border-navy-600">
            <h3 className="font-medium text-white mb-2 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              Glicko-2 &amp; ELO Skill Ratings
            </h3>
            <p className="text-sm text-text-secondary mb-3">
              Beyond RS and Brier, the leaderboard offers 11 sorting systems including Glicko-2 (uncertainty-aware skill rating), ELO (head-to-head), Peer Score (vs. community consensus), AI Score (vs. the Oracul), and more. All systems support per-tag filtering so you can compare forecasters within a specific topic.
            </p>
            <ul className="text-sm text-text-secondary space-y-1 ml-4">
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-1">•</span>
                <span><strong>Glicko-2:</strong> ranks by μ − 3σ, so one-hit wonders never outrank consistent experts</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-1">•</span>
                <span><strong>Per-tag leaderboard:</strong> select any topic tag to see who is most skilled in that domain specifically</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Key Features */}
      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Key Features</h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3 bg-navy-800 rounded-lg">
              <p className="font-medium text-sm text-white mb-1">🎯 Create & Track</p>
              <p className="text-xs text-text-secondary">Define forecasts with specific resolution criteria and deadlines</p>
            </div>
            <div className="p-3 bg-navy-800 rounded-lg">
              <p className="font-medium text-sm text-white mb-1">📊 Live Odds</p>
              <p className="text-xs text-text-secondary">See real-time probability distributions based on community commitments</p>
            </div>
            <div className="p-3 bg-navy-800 rounded-lg">
              <p className="font-medium text-sm text-white mb-1">🤖 AI Assistance</p>
              <p className="text-xs text-text-secondary">Extract forecasts from news articles and get AI probability estimates via the Oracul</p>
            </div>
            <div className="p-3 bg-navy-800 rounded-lg">
              <p className="font-medium text-sm text-white mb-1">🔗 Social Sharing</p>
              <p className="text-xs text-text-secondary">Share your forecasts with customizable cards and OG images</p>
            </div>
            <div className="p-3 bg-navy-800 rounded-lg">
              <p className="font-medium text-sm text-white mb-1">📈 Leaderboards</p>
              <p className="text-xs text-text-secondary">11 scoring systems — ELO, Glicko-2, Brier, Peer Score, and more — with per-tag filtering</p>
            </div>
            <div className="p-3 bg-navy-800 rounded-lg">
              <p className="font-medium text-sm text-white mb-1">🔔 Notifications</p>
              <p className="text-xs text-text-secondary">Email and push alerts for deadlines, comments, and resolutions</p>
            </div>
          </div>
        </div>
      </div>

      {/* Resources */}
      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Resources & Community</h2>
        </div>
        <div className="p-6 space-y-3">
          <a
            href="https://github.com/Daatan/daatan"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-3 bg-navy-800 hover:bg-navy-700 rounded-lg transition-colors"
          >
            <Github className="w-5 h-5 text-text-secondary" />
            <div>
              <p className="font-medium text-white text-sm">GitHub Repository</p>
              <p className="text-xs text-text-secondary">View source code and contribute</p>
            </div>
          </a>
          <a
            href="https://x.com/daatan_dev"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-3 bg-navy-800 hover:bg-navy-700 rounded-lg transition-colors"
          >
            <Twitter className="w-5 h-5 text-text-secondary" />
            <div>
              <p className="font-medium text-white text-sm">Twitter / X</p>
              <p className="text-xs text-text-secondary">Follow for updates and announcements</p>
            </div>
          </a>
        </div>
      </div>

      {/* Contact & Version */}
      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Contact & Info</h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-navy-800 text-text-secondary rounded-lg">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <p className="font-medium text-white">Get in Touch</p>
              <div className="flex items-center gap-3 text-sm">
                <Link href="/contact" className="text-cobalt-light hover:underline">
                  Contact form
                </Link>
                <span className="text-text-subtle">·</span>
                <a href={`mailto:${getContactEmail()}`} className="text-cobalt-light hover:underline">
                  {getContactEmail()}
                </a>
              </div>
            </div>
          </div>
          <div className="pt-4 border-t border-navy-600 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4 text-sm text-text-subtle">
              <span>Version <span className="font-mono">{VERSION}</span></span>
              {commitShort && (
                <span className="flex items-center gap-1">
                  <GitCommit className="w-3.5 h-3.5" />
                  <Link
                    href={`https://github.com/Daatan/daatan/commit/${gitCommit}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono hover:text-cobalt-light hover:underline"
                  >
                    {commitShort}
                  </Link>
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 text-sm text-text-subtle">
              <Link href="/methodology" className="hover:text-white hover:underline">Scoring Methodology</Link>
              <Link href="/privacy" className="hover:text-white hover:underline">Privacy Policy</Link>
              <Link href="/terms" className="hover:text-white hover:underline">Terms of Service</Link>
              <Link href="/disclaimer" className="hover:text-white hover:underline">Disclaimer</Link>
              <Link href="/accessibility" className="hover:text-white hover:underline">Accessibility</Link>
              <span>&copy; {new Date().getFullYear()} DAATAN</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

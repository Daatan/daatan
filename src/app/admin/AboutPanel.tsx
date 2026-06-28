'use client'
import { useState, useEffect } from 'react'
import { Loader2, Check, X } from 'lucide-react'

type About = {
  version: string
  edition: string
  appName: string
  appUrl: string
  capabilities: { ai: boolean; externalMarkets: boolean }
  auth: { google: boolean; oidc: boolean; adminEmails: boolean; domainAllowlist: boolean; openSignup: boolean }
  storage: { driver: string }
  integrations: { gemini: boolean; ollama: boolean; oracle: boolean; email: boolean; telegram: boolean; newsIndexer: boolean }
}

function Flag({ on }: { on: boolean }) {
  return on ? (
    <span className="inline-flex items-center gap-1 text-green-400"><Check className="w-4 h-4" /> on</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-gray-500"><X className="w-4 h-4" /> off</span>
  )
}

function Section({ title, rows }: { title: string; rows: [string, React.ReactNode][] }) {
  return (
    <div className="bg-navy-700 border border-navy-600 rounded-lg overflow-hidden">
      <div className="bg-navy-800 px-4 py-2 text-sm font-semibold text-text-secondary uppercase tracking-wider">{title}</div>
      <dl className="divide-y divide-navy-600">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <dt className="text-gray-400">{k}</dt>
            <dd className="text-white font-mono">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export default function AboutPanel() {
  const [data, setData] = useState<About | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/about')
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    )
  }
  if (!data) return <div className="text-center py-12 text-gray-500 text-sm">Failed to load.</div>

  return (
    <div className="space-y-4 max-w-2xl">
      <Section
        title="Instance"
        rows={[
          ['Name', data.appName],
          ['URL', data.appUrl],
          ['Edition', data.edition],
          ['Version', `v${data.version}`],
        ]}
      />
      <Section
        title="Capabilities"
        rows={[
          ['AI features', <Flag key="ai" on={data.capabilities.ai} />],
          ['External markets', <Flag key="m" on={data.capabilities.externalMarkets} />],
        ]}
      />
      <Section
        title="Authentication"
        rows={[
          ['Google OAuth', <Flag key="g" on={data.auth.google} />],
          ['OIDC SSO', <Flag key="o" on={data.auth.oidc} />],
          ['Admin-email mapping', <Flag key="ae" on={data.auth.adminEmails} />],
          ['Email-domain allow-list', <Flag key="d" on={data.auth.domainAllowlist} />],
          ['Open password signup', <Flag key="s" on={data.auth.openSignup} />],
        ]}
      />
      <Section title="Storage" rows={[['Driver', data.storage.driver]]} />
      <Section
        title="Integrations"
        rows={[
          ['Gemini (LLM)', <Flag key="ge" on={data.integrations.gemini} />],
          ['Ollama (LLM)', <Flag key="ol" on={data.integrations.ollama} />],
          ['Oracle co-forecaster', <Flag key="or" on={data.integrations.oracle} />],
          ['Email (outbound)', <Flag key="em" on={data.integrations.email} />],
          ['Telegram', <Flag key="tg" on={data.integrations.telegram} />],
          ['News-indexer', <Flag key="ni" on={data.integrations.newsIndexer} />],
        ]}
      />
    </div>
  )
}

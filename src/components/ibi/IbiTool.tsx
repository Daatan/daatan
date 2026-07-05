'use client'

import { useState, useCallback } from 'react'

const EXTRACT_PROMPT = `Article (published {date}):
{article_text}

Extract every forward-looking prediction or forecast the author makes in this article.
For each prediction return:
- quote: exact text from article (short, the key sentence)
- claim: clean one-sentence statement of what is being predicted
- author_probability: your estimate (0-100) of the probability the author implies. 60 means the author thinks it is likely, 40 means unlikely, 50 means neutral/uncertain.

Return valid JSON only, no other text:
{ "predictions": [{ "quote": "...", "claim": "...", "author_probability": 60 }] }`

const CONSENSUS_PROMPT = `Article (published {date}):
{article_text}

Regarding this specific forecast: "{claim}"

What probability (0-100) does this article assign to this forecast happening?
- 60-100: article thinks it will happen
- 40-60: article is uncertain/neutral
- 0-40: article thinks it will NOT happen
- null: article does not address this forecast at all

Return valid JSON only, no other text:
{ "probability": 55, "reasoning": "one sentence explanation" }`

const MODELS = [
  { label: 'Gemini 2.5 Flash', value: 'google/gemini-2.5-flash' },
  { label: 'Gemini 2.5 Flash (free)', value: 'google/gemini-2.5-flash:free' },
  { label: 'DeepSeek R1 (free)', value: 'deepseek/deepseek-r1:free' },
  { label: 'Llama 3.3 70B (free)', value: 'meta-llama/llama-3.3-70b-instruct:free' },
  { label: 'Claude 3.5 Haiku', value: 'anthropic/claude-3-5-haiku' },
  { label: 'Custom', value: '__custom__' },
]

interface Prediction {
  quote: string
  claim: string
  author_probability: number
}

interface SearchResult {
  title: string
  url: string
  snippet: string
  source: string
  published_date?: string
}

interface ConsensusResult {
  url: string
  title: string
  source: string
  published_date?: string
  /** The prediction claim this probability was computed for. */
  claim: string
  probability: number | null
  reasoning: string
}

interface State {
  articleUrl: string
  articleDate: string
  articleText: string
  articleTitle: string
  predictions: Prediction[]
  searchResults: SearchResult[]
  consensusResults: ConsensusResult[]
}

function cleanJson(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
}

export default function IbiTool() {
  const [state, setState] = useState<State>({
    articleUrl: '',
    articleDate: '',
    articleText: '',
    articleTitle: '',
    predictions: [],
    searchResults: [],
    consensusResults: [],
  })

  const [stage, setStage] = useState<1 | 2 | 3>(1)
  const [stagesDone, setStagesDone] = useState({ s1: false, s2: false })

  const [s1Prompt, setS1Prompt] = useState(EXTRACT_PROMPT)
  const [s1Model, setS1Model] = useState('google/gemini-2.5-flash')
  const [s1ModelCustom, setS1ModelCustom] = useState('')
  const [s1Output, setS1Output] = useState('')
  const [s1Error, setS1Error] = useState('')
  const [s1Loading, setS1Loading] = useState(false)

  const [s2Query, setS2Query] = useState('')
  const [s2DateTo, setS2DateTo] = useState('')
  const [s2Model, setS2Model] = useState('google/gemini-2.5-flash')
  const [s2ModelCustom, setS2ModelCustom] = useState('')
  const [s2ConsensusPrompt, setS2ConsensusPrompt] = useState(CONSENSUS_PROMPT)
  const [s2Error, setS2Error] = useState('')
  const [s2Loading, setS2Loading] = useState(false)
  const [s2SearchLoading, setS2SearchLoading] = useState(false)
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set())
  const [articlePreview, setArticlePreview] = useState('')
  const [fetchLoading, setFetchLoading] = useState(false)
  const [fetchError, setFetchError] = useState('')

  const getModel = (model: string, custom: string) =>
    model === '__custom__' ? custom.trim() : model

  const callLLM = useCallback(async (model: string, prompt: string): Promise<string> => {
    const res = await fetch('/api/ibi/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.1 }),
    })
    if (!res.ok) throw new Error(`LLM error ${res.status}`)
    const data = await res.json()
    return cleanJson(data.content ?? '')
  }, [])

  const fetchArticle = async () => {
    setFetchError('')
    setFetchLoading(true)
    try {
      const res = await fetch('/api/ibi/fetch-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: state.articleUrl }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const text = data.text ?? ''
      const date = data.date ?? state.articleDate
      setState(s => ({ ...s, articleText: text, articleTitle: data.title ?? '', articleDate: date }))
      setArticlePreview(text.slice(0, 600))
      setS1Prompt(
        EXTRACT_PROMPT
          .replace('{date}', () => date)
          .replace('{article_text}', () => text.slice(0, 6000)),
      )
      setStage(1)
    } catch (e) {
      setFetchError(String(e))
    } finally {
      setFetchLoading(false)
    }
  }

  const runStage1 = async () => {
    setS1Error('')
    setS1Loading(true)
    try {
      const model = getModel(s1Model, s1ModelCustom)
      const raw = await callLLM(model, s1Prompt)
      setS1Output(raw)
    } catch (e) {
      setS1Error(String(e))
    } finally {
      setS1Loading(false)
    }
  }

  const proceedToStage2 = () => {
    try {
      const parsed = JSON.parse(s1Output)
      const preds: Prediction[] = parsed.predictions ?? []
      setState(s => ({ ...s, predictions: preds }))
      if (preds[0]) {
        const year = state.articleDate ? state.articleDate.slice(0, 4) : new Date().getFullYear()
        setS2Query(`${preds[0].claim} ${year}`)
      }
      setStagesDone(d => ({ ...d, s1: true }))
      setStage(2)
    } catch {
      setS1Error('Failed to parse predictions JSON. Fix the output above and try again.')
    }
  }

  const runSearch = async () => {
    setS2Error('')
    setS2SearchLoading(true)
    try {
      const body: Record<string, unknown> = { query: s2Query, limit: 10 }
      if (s2DateTo) body.date_to = s2DateTo
      const res = await fetch('/api/ibi/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setState(s => ({ ...s, searchResults: data.results ?? [] }))
      setSelectedUrls(new Set())
    } catch (e) {
      setS2Error(String(e))
    } finally {
      setS2SearchLoading(false)
    }
  }

  const runConsensus = async () => {
    setS2Error('')
    setS2Loading(true)
    const model = getModel(s2Model, s2ModelCustom)
    const results: ConsensusResult[] = []
    try {
      const articles = state.searchResults.filter(r => selectedUrls.has(r.url))
      for (const art of articles) {
        let text = art.snippet
        if (text.length < 200) {
          try {
            const res = await fetch('/api/ibi/fetch-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: art.url }),
            })
            if (res.ok) {
              const d = await res.json()
              text = (d.text ?? '').slice(0, 6000)
            }
          } catch { /* use snippet */ }
        }
        for (const pred of state.predictions) {
          const prompt = s2ConsensusPrompt
            .replace('{date}', () => art.published_date ?? '')
            .replace('{article_text}', () => text)
            .replace('{claim}', () => pred.claim)
          try {
            const raw = await callLLM(model, prompt)
            const parsed = JSON.parse(raw)
            results.push({
              url: art.url,
              title: art.title,
              source: art.source,
              published_date: art.published_date,
              claim: pred.claim,
              probability: parsed.probability ?? null,
              reasoning: parsed.reasoning ?? '',
            })
          } catch {
            results.push({ url: art.url, title: art.title, source: art.source, published_date: art.published_date, claim: pred.claim, probability: null, reasoning: 'parse error' })
          }
        }
      }
      setState(s => ({ ...s, consensusResults: results }))
      setStagesDone(d => ({ ...d, s2: true }))
    } catch (e) {
      setS2Error(String(e))
    } finally {
      setS2Loading(false)
    }
  }

  const proceedToStage3 = () => setStage(3)

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ ...state }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `ibi-analysis-${Date.now()}.json`
    a.click()
  }

  /** Average consensus probability for a single prediction, plus the number of
   *  articles that scored it. Only results computed for *this* claim are counted. */
  const consensusFor = (pred: Prediction): { avg: number; count: number } | null => {
    const probs = state.consensusResults
      .filter(r => r.claim === pred.claim && selectedUrls.has(r.url))
      .map(r => r.probability)
      .filter((p): p is number => p !== null)
    if (!probs.length) return null
    return { avg: Math.round(probs.reduce((a, b) => a + b, 0) / probs.length), count: probs.length }
  }

  const probColor = (p: number) =>
    p >= 60 ? 'text-green-400' : p >= 40 ? 'text-yellow-400' : 'text-red-400'

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6 font-mono text-sm">
      <h1 className="text-xl font-bold text-white">IBI Retro Analysis</h1>

      {/* Article Input */}
      <section className="bg-gray-900 rounded-lg p-4 space-y-3">
        <h2 className="font-semibold text-gray-300">Article</h2>
        <div className="flex gap-2">
          <input
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 focus:outline-none focus:border-blue-500"
            value={state.articleUrl}
            onChange={e => setState(s => ({ ...s, articleUrl: e.target.value }))}
            placeholder="Article URL"
            aria-label="Article URL"
          />
          <input
            className="w-36 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 focus:outline-none focus:border-blue-500"
            type="date"
            value={state.articleDate}
            onChange={e => setState(s => ({ ...s, articleDate: e.target.value }))}
            aria-label="Article date"
          />
          <button
            onClick={fetchArticle}
            disabled={fetchLoading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-white"
          >
            {fetchLoading ? '...' : 'Fetch'}
          </button>
        </div>
        {fetchError && <p className="text-red-400">{fetchError}</p>}
        {articlePreview && (
          <pre className="text-xs text-gray-400 bg-gray-800 rounded p-3 overflow-auto max-h-32 whitespace-pre-wrap">
            {articlePreview}…
          </pre>
        )}
      </section>

      {/* Stage 1 */}
      <section className={`bg-gray-900 rounded-lg p-4 space-y-3 ${!state.articleText ? 'opacity-50 pointer-events-none' : ''}`}>
        <h2 className="font-semibold text-gray-300">Stage 1 — Extract Forecasts</h2>
        <ModelSelect model={s1Model} custom={s1ModelCustom} onModel={setS1Model} onCustom={setS1ModelCustom} />
        <textarea
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-xs focus:outline-none focus:border-blue-500 h-40 resize-y"
          value={s1Prompt}
          onChange={e => setS1Prompt(e.target.value)}
          aria-label="Extraction prompt"
        />
        <button
          onClick={runStage1}
          disabled={s1Loading}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-white"
        >
          {s1Loading ? 'Running…' : 'Run Extraction'}
        </button>
        {s1Error && <p className="text-red-400">{s1Error}</p>}
        {s1Output && (
          <>
            <textarea
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-xs h-40 resize-y focus:outline-none focus:border-blue-500"
              value={s1Output}
              onChange={e => setS1Output(e.target.value)}
              aria-label="Extraction output"
            />
            <button
              onClick={proceedToStage2}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-white"
            >
              Next → Consensus Search
            </button>
          </>
        )}
      </section>

      {/* Stage 2 */}
      <section className={`bg-gray-900 rounded-lg p-4 space-y-3 ${!stagesDone.s1 ? 'opacity-50 pointer-events-none' : ''}`}>
        <h2 className="font-semibold text-gray-300">Stage 2 — Consensus Search</h2>
        <div className="flex gap-2">
          <input
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 focus:outline-none focus:border-blue-500"
            value={s2Query}
            onChange={e => setS2Query(e.target.value)}
            placeholder="Search query"
            aria-label="Search query"
          />
          <input
            className="w-36 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 focus:outline-none focus:border-blue-500"
            type="date"
            value={s2DateTo}
            onChange={e => setS2DateTo(e.target.value)}
            placeholder="Date to"
            aria-label="Date to"
          />
          <button
            onClick={runSearch}
            disabled={s2SearchLoading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-white"
          >
            {s2SearchLoading ? '...' : 'Search'}
          </button>
        </div>

        {state.searchResults.length > 0 && (
          <div className="space-y-2">
            {state.searchResults.map(r => (
              // eslint-disable-next-line jsx-a11y/label-has-associated-control -- text comes from r.title/r.snippet expressions, which the static rule can't see
              <label key={r.url} className="flex gap-2 items-start cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedUrls.has(r.url)}
                  onChange={e => {
                    setSelectedUrls(prev => {
                      const next = new Set(prev)
                      e.target.checked ? next.add(r.url) : next.delete(r.url)
                      return next
                    })
                  }}
                  className="mt-1 shrink-0"
                />
                <div>
                  <span className="text-blue-400">{r.title}</span>
                  <span className="text-gray-500 ml-2">{r.source} · {r.published_date ?? ''}</span>
                  <p className="text-gray-400 text-xs">{r.snippet}</p>
                </div>
              </label>
            ))}
          </div>
        )}

        <ModelSelect model={s2Model} custom={s2ModelCustom} onModel={setS2Model} onCustom={setS2ModelCustom} />
        <textarea
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 text-xs focus:outline-none focus:border-blue-500 h-40 resize-y"
          value={s2ConsensusPrompt}
          onChange={e => setS2ConsensusPrompt(e.target.value)}
          aria-label="Consensus prompt"
        />
        <button
          onClick={runConsensus}
          disabled={s2Loading || selectedUrls.size === 0}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-white"
        >
          {s2Loading ? 'Analyzing…' : 'Analyze Consensus'}
        </button>
        {s2Error && <p className="text-red-400">{s2Error}</p>}

        {state.consensusResults.length > 0 && (
          <>
            <div className="space-y-2">
              {state.consensusResults.map((r, i) => (
                <div key={i} className="bg-gray-800 rounded p-3 text-xs">
                  <span className="text-blue-400">{r.title}</span>
                  <span className="text-gray-500 ml-2">{r.source}</span>
                  <span className={`ml-2 font-bold ${r.probability !== null ? probColor(r.probability) : 'text-gray-500'}`}>
                    {r.probability !== null ? `${r.probability}%` : 'n/a'}
                  </span>
                  <p className="text-gray-400 mt-1">{r.reasoning}</p>
                </div>
              ))}
            </div>
            <button
              onClick={proceedToStage3}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-white"
            >
              Next → Compare
            </button>
          </>
        )}
      </section>

      {/* Stage 3 */}
      <section className={`bg-gray-900 rounded-lg p-4 space-y-4 ${stage < 3 ? 'opacity-50 pointer-events-none' : ''}`}>
        <h2 className="font-semibold text-gray-300">Stage 3 — Compare</h2>
        {stage === 3 && state.predictions.map((pred, i) => {
          const consensus = consensusFor(pred)
          const delta = consensus !== null ? pred.author_probability - consensus.avg : null
          return (
            <div key={i} className="bg-gray-800 rounded-lg p-4 space-y-2">
              <p className="font-bold text-white">{pred.claim}</p>
              <p className="text-gray-400 italic text-xs pl-2 border-l border-gray-600">&ldquo;{pred.quote}&rdquo;</p>
              <div className="flex gap-6 mt-2">
                <div>
                  <p className="text-xs text-gray-500">Author estimate</p>
                  <p className={`text-2xl font-bold ${probColor(pred.author_probability)}`}>{pred.author_probability}%</p>
                </div>
                {consensus !== null && (
                  <div>
                    <p className="text-xs text-gray-500">Consensus ({consensus.count} {consensus.count === 1 ? 'article' : 'articles'})</p>
                    <p className={`text-2xl font-bold ${probColor(consensus.avg)}`}>{consensus.avg}%</p>
                  </div>
                )}
              </div>
              {delta !== null && (
                <p className="text-xs text-gray-400">
                  Author was{' '}
                  <span className={delta > 0 ? 'text-green-400' : 'text-red-400'}>
                    {delta > 0 ? '+' : ''}{delta}pp {delta > 0 ? 'more bullish' : 'more bearish'} than consensus
                  </span>
                </p>
              )}
            </div>
          )
        })}
        {stage === 3 && (
          <button
            onClick={exportJson}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded text-white"
          >
            Export JSON
          </button>
        )}
      </section>
    </div>
  )
}

function ModelSelect({
  model, custom, onModel, onCustom,
}: {
  model: string
  custom: string
  onModel: (v: string) => void
  onCustom: (v: string) => void
}) {
  return (
    <div className="flex gap-2 items-center">
      <select
        className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 focus:outline-none focus:border-blue-500"
        value={model}
        onChange={e => onModel(e.target.value)}
        aria-label="Model"
      >
        {MODELS.map(m => (
          <option key={m.value} value={m.value}>{m.label}</option>
        ))}
      </select>
      {model === '__custom__' && (
        <input
          className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 focus:outline-none focus:border-blue-500"
          value={custom}
          onChange={e => onCustom(e.target.value)}
          placeholder="provider/model-name"
          aria-label="Custom model name"
        />
      )}
    </div>
  )
}

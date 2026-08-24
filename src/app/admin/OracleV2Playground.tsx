'use client'

/**
 * Oracle 2.0 playground (retro#595) inside the admin panel. Same trace format
 * as retro's public `oracle-v2-test.html`, but the Oracle key stays on the
 * server: calls go through /api/admin/oracle-v2/* (ADMIN-only proxies).
 * Graph is plain SVG — no graph dependency (node_modules is tracked in git).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

type Flat = {
  p: number | null; std?: number; ci?: [number, number]; articles_used?: number; n_eff?: number
  reason?: string | null; elapsed_ms?: number; sources?: Array<{ url: string; source_name: string; stance: number; published_date?: string; evidence_class?: string; claims?: string[] }>
}
type Market = { url?: string; question?: string; slug?: string }
type Node = {
  id: string; text: string; depth: number; parent_id: string | null; status: string; flat: Flat | null
  anchor: { p: number; market: Market; verdict?: { why?: string } } | null
  anchor_candidate?: { p: number; market: Market; verdict?: { why?: string } | null } | null
  propagated: number | null; pruned: boolean; prune_score: number | null; explanation: string | null; why?: string | null; effect?: string | null
}
type Edge = {
  id: string; source: string; target: string; method: 'pool_split' | 'unpriced'; p_given_yes: number | null; p_given_no: number | null
  conditional_hits?: number; detail?: { yes?: { articles_used?: number }; no?: { articles_used?: number } }; reason?: string | null
}
type Prompt = { id: string; step: string; node_id: string; model: string; messages: Array<{ role: string; content: string }>; response: string | null; usage?: unknown; elapsed_ms?: number | null; error?: string | null }
type Job = {
  id: string; status: 'queued' | 'running' | 'done' | 'failed'; error?: string | null; question: string
  nodes: Node[]; edges: Edge[]; prompts: Prompt[]; log: Array<{ at: string; node_id?: string | null; message: string }>
  calls: { forecast: number; pool_aggregate: number; llm: number; polymarket: number }
  result: { flat_p: number | null; propagated_p: number | null; note?: string } | null
}

const pct = (p: number | null | undefined) => (p == null ? '–' : `${Math.round(p * 100)}%`)
const maxNodeDepth = (job: Job) => job.nodes.reduce((max, n) => Math.max(max, n.depth), 0)
const NODE_W = 190, NODE_H = 58, COL = 230, ROW = 150

export default function OracleV2Playground() {
  const [question, setQuestion] = useState('')
  const [depth, setDepth] = useState(2)
  const [maxPrecursors, setMaxPrecursors] = useState(5)
  const [maxCalls, setMaxCalls] = useState(15)
  const [maxArticles, setMaxArticles] = useState(10)
  const [deadline, setDeadline] = useState('')
  const [job, setJob] = useState<Job | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [status, setStatus] = useState('idle')
  const [busy, setBusy] = useState(false)
  const [pane, setPane] = useState<'node' | 'prompts' | 'log' | 'json'>('node')
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    try { setQuestion(localStorage.getItem('oracle_v2_q') || '') } catch { /* ignore */ }
    const h = window.location.hash.slice(1)
    if (h) watch(h)
    return () => { if (timer.current) clearInterval(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const watch = useCallback((id: string) => {
    setJobId(id)
    window.history.replaceState(null, '', `#${id}`)
    if (timer.current) clearInterval(timer.current)
    const tick = async () => {
      try {
        const r = await fetch(`/api/admin/oracle-v2/jobs/${id}`)
        if (!r.ok) throw new Error(String(r.status))
        const j: Job = await r.json()
        setJob(j)
        setStatus(j.status + (j.error ? ` — ${j.error}` : ''))
        if (j.status === 'done' || j.status === 'failed') {
          if (timer.current) clearInterval(timer.current)
          setBusy(false)
        }
      } catch (e) {
        setStatus(`poll error: ${(e as Error).message}`)
      }
    }
    void tick()
    timer.current = setInterval(tick, 3000)
  }, [])

  const run = async () => {
    const q = question.trim()
    if (!q) return
    try { localStorage.setItem('oracle_v2_q', q) } catch { /* ignore */ }
    setBusy(true); setStatus('starting…'); setSelected(null)
    try {
      const r = await fetch('/api/admin/oracle-v2/forecast', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, depth, max_precursors: maxPrecursors, max_forecast_calls: maxCalls, max_articles: maxArticles, claim_deadline: deadline || null }),
      })
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`)
      const { job_id } = await r.json()
      watch(job_id)
    } catch (e) {
      setStatus(`error: ${(e as Error).message}`); setBusy(false)
    }
  }

  const node = job?.nodes.find((n) => n.id === selected) ?? null
  const dotClass = job?.status === 'done' ? 'bg-green-500' : job?.status === 'failed' ? 'bg-red-500' : busy ? 'bg-amber-500' : 'bg-gray-400'

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm text-gray-500">
        Oracle 2.0 query path (P0–P6) — logic + v1 pricing; edges from the antecedent pool-split only, never elicited. Trace format = retro <code>/v2/jobs/{'{id}'}</code>.
      </div>
      <div className="flex flex-col lg:flex-row gap-4">
        <aside className="w-full lg:w-80 shrink-0 flex flex-col gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <label className="text-xs uppercase tracking-wide text-gray-500">Question
            <textarea className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 bg-transparent p-2 text-sm min-h-[80px]" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Will Israel withdraw its troops from southern Lebanon by December 31, 2026?" />
          </label>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label>Depth (1–6)<select className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 bg-transparent p-1" value={depth} onChange={(e) => setDepth(+e.target.value)}>{[1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
            <label>Keep / node<input type="number" min={1} max={10} className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 bg-transparent p-1" value={maxPrecursors} onChange={(e) => setMaxPrecursors(+e.target.value)} /></label>
            <label>Forecast calls<input type="number" min={1} max={80} className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 bg-transparent p-1" value={maxCalls} onChange={(e) => setMaxCalls(+e.target.value)} /></label>
            <label>Articles / call<input type="number" min={3} max={30} className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 bg-transparent p-1" value={maxArticles} onChange={(e) => setMaxArticles(+e.target.value)} /></label>
            <label className="col-span-2">Deadline (optional)<input type="date" className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 bg-transparent p-1" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
          </div>
          <div className="flex gap-2">
            <button className="flex-1 rounded bg-blue-600 text-white px-3 py-2 text-sm disabled:opacity-50" disabled={busy || !question.trim()} onClick={run}>Run</button>
            <button className="rounded border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm" onClick={() => { const id = window.prompt('job id'); if (id) watch(id.trim()) }}>Load job…</button>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500"><span className={`inline-block w-2 h-2 rounded-full ${dotClass}`} />{status}</div>
          {job?.result && (
            <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
              <div className="text-2xl font-mono">{pct(job.result.propagated_p)} <span className="text-xs text-gray-500 font-sans">propagated</span></div>
              <div className="text-base font-mono">{pct(job.result.flat_p)} <span className="text-xs text-gray-500 font-sans">flat (v1)</span></div>
              {job.result.note && <div className="text-xs text-gray-500 mt-1">{job.result.note}</div>}
              <div className="text-xs text-gray-500 font-mono mt-1">calls — forecast {job.calls.forecast} · pool {job.calls.pool_aggregate} · llm {job.calls.llm} · pm {job.calls.polymarket}</div>
              {job.status === 'done' && maxNodeDepth(job) < depth && (
                <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Requested depth {depth}, tree stopped at depth {maxNodeDepth(job)} — every node at that depth was pruned, unpriced, or the forecast-call budget ran out, so there was nothing left to expand.
                </div>
              )}
            </div>
          )}
          <div className="text-xs text-gray-400">Job <span className="font-mono">{jobId ?? '–'}</span></div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-auto bg-gray-50 dark:bg-gray-900" style={{ minHeight: 320 }}>
            {job ? <Graph job={job} selected={selected} onSelect={(id) => { setSelected(id); setPane('node') }} /> : <div className="p-6 text-sm text-gray-400">Run a question to see the graph.</div>}
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 px-2 pt-1 text-sm">
              {(['node', 'prompts', 'log', 'json'] as const).map((p) => (
                <button key={p} className={`px-3 py-1.5 rounded-t ${pane === p ? 'bg-gray-100 dark:bg-gray-800 font-medium' : 'text-gray-500'}`} onClick={() => setPane(p)}>
                  {p === 'prompts' && job?.prompts.length ? `prompts (${job.prompts.length})` : p}
                </button>
              ))}
            </div>
            <div className="p-3 text-sm max-h-[360px] overflow-auto">
              {pane === 'node' && (node ? <NodePanel n={node} job={job!} /> : <span className="text-gray-400">Click a node.</span>)}
              {pane === 'prompts' && (job?.prompts.length ? job.prompts.map((p) => (
                <details key={p.id} className="mb-2 rounded border border-gray-200 dark:border-gray-700">
                  <summary className="cursor-pointer px-2 py-1 text-blue-600">{p.id} · {p.step} · {p.node_id} · {p.model} · {p.elapsed_ms ?? '…'} ms{p.error && <span className="text-red-500"> · {p.error}</span>}</summary>
                  <div className="px-2 pb-2">
                    {p.messages.map((m, i) => <pre key={i} className="whitespace-pre-wrap text-xs bg-gray-100 dark:bg-gray-800 rounded p-2 my-1 max-h-64 overflow-auto">[{m.role}]{'\n'}{m.content}</pre>)}
                    <div className="text-xs uppercase text-gray-500">response</div>
                    <pre className="whitespace-pre-wrap text-xs bg-gray-100 dark:bg-gray-800 rounded p-2 my-1 max-h-64 overflow-auto">{p.response ?? '(pending)'}</pre>
                    {p.usage != null && <div className="text-xs text-gray-500 font-mono">usage {JSON.stringify(p.usage)}</div>}
                  </div>
                </details>
              )) : <span className="text-gray-400">No prompts yet.</span>)}
              {pane === 'log' && job?.log.map((l, i) => <div key={i} className="font-mono text-xs text-gray-500">{l.at.slice(11, 19)} <b className="text-gray-800 dark:text-gray-200 font-medium">{l.node_id || ''}</b> {l.message}</div>)}
              {pane === 'json' && <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(job, null, 2)}</pre>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function nodeLabel(n: Node): [string, string] {
  const p = n.anchor ? `🔒 ${pct(n.anchor.p)}` : n.flat && n.flat.p != null ? pct(n.flat.p) : n.status === 'pricing' ? '…' : '?'
  const prop = n.propagated != null && (!n.flat || n.propagated !== n.flat.p) ? ` → ${pct(n.propagated)}` : ''
  return [n.text.length > 70 ? `${n.text.slice(0, 67)}…` : n.text, `${p}${prop}${n.pruned ? '  (pruned)' : ''}`]
}

function Graph({ job, selected, onSelect }: { job: Job; selected: string | null; onSelect: (id: string) => void }) {
  const byDepth: Record<number, Node[]> = {}
  job.nodes.forEach((n) => { (byDepth[n.depth] ||= []).push(n) })
  const pos: Record<string, { x: number; y: number }> = {}
  let maxRow = 1, maxDepth = 0
  Object.entries(byDepth).forEach(([d, row]) => {
    maxRow = Math.max(maxRow, row.length); maxDepth = Math.max(maxDepth, +d)
    row.forEach((n, i) => { pos[n.id] = { x: (i - (row.length - 1) / 2) * COL, y: +d * ROW } })
  })
  const width = Math.max(600, maxRow * COL + 80), height = (maxDepth + 1) * ROW + 40
  const ox = width / 2, oy = NODE_H / 2 + 20
  const stroke = (n: Node) => (selected === n.id ? '#60A5FA' : n.status === 'anchored' ? '#e2b96f' : n.pruned ? '#9CA3AF' : ['unpriced', 'failed', 'proposed'].includes(n.status) ? '#F59E0B' : n.depth === 0 ? '#e2b96f' : '#3B82F6')
  return (
    <svg width={width} height={height} className="block mx-auto">
      {job.edges.map((e) => {
        const s = pos[e.source], t = pos[e.target]
        if (!s || !t) return null
        const x1 = s.x + ox, y1 = s.y + oy - NODE_H / 2, x2 = t.x + ox, y2 = t.y + oy + NODE_H / 2
        const priced = e.method === 'pool_split'
        return (
          <g key={e.id} className="cursor-pointer" onClick={() => onSelect(e.source)}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={12} />
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={priced ? '#22C55E' : '#F59E0B'} strokeWidth={selected === e.source ? 3 : priced ? 2 : 1.2} strokeDasharray={priced ? undefined : '5 4'} />
            <text x={(x1 + x2) / 2} y={(y1 + y2) / 2} fontSize={9} fill="#6B7280" textAnchor="middle">{priced ? `✓${pct(e.p_given_yes)} ✗${pct(e.p_given_no)}` : 'unpriced'}</text>
          </g>
        )
      })}
      {job.nodes.map((n) => {
        const p = pos[n.id]; const [l1, l2] = nodeLabel(n); const root = n.depth === 0
        const w = root ? NODE_W + 50 : NODE_W
        return (
          <g key={n.id} transform={`translate(${p.x + ox - w / 2},${p.y + oy - NODE_H / 2})`} className="cursor-pointer" opacity={n.pruned ? 0.5 : 1} onClick={() => onSelect(n.id)}>
            <rect width={w} height={NODE_H} rx={8} fill={root ? '#142843' : '#1C3452'} stroke={stroke(n)} strokeWidth={selected === n.id || n.status === 'anchored' ? 3 : 1.5} />
            <text x={w / 2} y={22} fontSize={root ? 10.5 : 9.5} fill="#E2E8F0" textAnchor="middle" fontWeight={root ? 600 : 400}>{l1.length > 36 ? `${l1.slice(0, 34)}…` : l1}</text>
            <text x={w / 2} y={36} fontSize={9} fill="#CBD5E1" textAnchor="middle">{l1.length > 36 ? l1.slice(34, 70) : ''}</text>
            <text x={w / 2} y={50} fontSize={10} fill="#E2E8F0" textAnchor="middle" fontFamily="ui-monospace, monospace">{l2}</text>
          </g>
        )
      })}
    </svg>
  )
}

function Tag({ children, color }: { children: React.ReactNode; color?: string }) {
  return <span className="inline-block rounded-full border px-2 text-xs mr-1" style={{ borderColor: color ?? '#9CA3AF', color: color ?? undefined }}>{children}</span>
}

function NodePanel({ n, job }: { n: Node; job: Job }) {
  const f = n.flat ?? ({} as Flat)
  const inEdges = job.edges.filter((e) => e.target === n.id)
  const out = job.edges.find((e) => e.source === n.id)
  return (
    <div>
      <div className="text-base mb-1">{n.text}</div>
      <div className="mb-2">
        <Tag>{n.id} · depth {n.depth}</Tag><Tag>{n.status}</Tag>
        {n.anchor && <Tag color="#e2b96f">anchor: polymarket</Tag>}
        {n.anchor_candidate && <Tag color="#F59E0B">polymarket candidate rejected</Tag>}
        {n.pruned && <Tag color="#EF4444">pruned</Tag>}
        {n.effect && <Tag>{n.effect} parent</Tag>}
      </div>
      <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-gray-500">flat p (v1)</dt><dd>{pct(f.p)} {f.ci ? `(CI ${pct(f.ci[0])}–${pct(f.ci[1])}, std ${f.std})` : ''} · {f.articles_used ?? '–'} articles · n_eff {f.n_eff ?? '–'} · {f.reason || ''} {f.elapsed_ms ? `· ${f.elapsed_ms} ms` : ''}</dd>
        <dt className="text-gray-500">propagated p</dt><dd>{pct(n.propagated)}</dd>
        {n.anchor && <><dt className="text-gray-500">anchor</dt><dd>🔒 {pct(n.anchor.p)} — <a className="text-blue-600" href={n.anchor.market.url || '#'} target="_blank" rel="noreferrer">{n.anchor.market.question || n.anchor.market.slug}</a></dd></>}
        {n.anchor_candidate && <><dt className="text-gray-500">rejected market</dt><dd>{pct(n.anchor_candidate.p)} — <a className="text-blue-600" href={n.anchor_candidate.market.url || '#'} target="_blank" rel="noreferrer">{n.anchor_candidate.market.question}</a> · {n.anchor_candidate.verdict?.why || 'no verdict'}</dd></>}
        <dt className="text-gray-500">why (decomposer)</dt><dd>{n.why || n.explanation || ''}</dd>
        <dt className="text-gray-500">pruning</dt><dd>{n.explanation || ''} {n.prune_score != null ? `· score ${n.prune_score}` : ''}</dd>
        {out && <><dt className="text-gray-500">edge → parent</dt><dd>
          <Tag color={out.method === 'pool_split' ? '#22C55E' : '#F59E0B'}>{out.method}</Tag>
          {out.method === 'pool_split'
            ? `P(parent | yes) = ${pct(out.p_given_yes)} (${out.detail?.yes?.articles_used ?? '–'} art.) · P(parent | no) = ${pct(out.p_given_no)} (${out.detail?.no?.articles_used ?? '–'} art.) · ${out.conditional_hits ?? '–'} conditional source(s)`
            : out.reason || ''}
        </dd></>}
        {inEdges.length > 0 && <><dt className="text-gray-500">precursors</dt><dd>{inEdges.length} proposed · {inEdges.filter((e) => e.method === 'pool_split').length} priced</dd></>}
      </dl>
      {f.sources && f.sources.length > 0 && (
        <div className="mt-3">
          <div className="text-xs uppercase text-gray-500 mb-1">evidence ({f.sources.length})</div>
          {f.sources.map((s, i) => (
            <div key={i} className="text-sm my-0.5">
              <Tag>{s.stance > 0.1 ? '▲' : s.stance < -0.1 ? '▼' : '•'} {(s.stance ?? 0).toFixed(2)}</Tag>
              <a className="text-blue-600" href={s.url} target="_blank" rel="noreferrer">{s.source_name}</a> <span className="text-gray-500">{s.published_date || ''} · {s.evidence_class || ''}</span>
              {s.claims?.[0] && <div className="text-xs text-gray-500 ml-2">“{s.claims[0]}”</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

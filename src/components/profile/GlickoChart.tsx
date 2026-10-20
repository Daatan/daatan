'use client'

import { useEffect, useState } from 'react'
import type { GlickoDataPoint } from '@/lib/services/expertise'

interface GlickoChartProps {
  userId: string
  selectedTag: string | null
}

const W = 480
const H = 140
const PAD = { top: 12, right: 16, bottom: 28, left: 44 }
const INNER_W = W - PAD.left - PAD.right
const INNER_H = H - PAD.top - PAD.bottom

export function GlickoChart({ userId, selectedTag }: GlickoChartProps) {
  const url = `/api/profile/${userId}/glicko-history${selectedTag ? `?tag=${selectedTag}` : ''}`
  // The result is tagged with the URL it was fetched for, so a new user/tag reads as "loading" without a reset-in-effect.
  const [result, setResult] = useState<{ url: string; points: GlickoDataPoint[] | null; error: boolean } | null>(null)
  const current = result?.url === url ? result : null
  const points = current?.points ?? null
  const error = current?.error ?? false

  useEffect(() => {
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => setResult({ url, points: d.points ?? [], error: false }))
      .catch(() => setResult({ url, points: null, error: true }))
  }, [url])

  if (error) return (
    <div className="h-[140px] flex items-center justify-center text-xs text-gray-500">
      Could not load skill history
    </div>
  )

  if (points === null) return (
    <div className="h-[140px] flex items-center justify-center text-xs text-gray-600">Loading…</div>
  )

  if (points.length < 2) return (
    <div className="h-[140px] flex items-center justify-center text-xs text-gray-600">
      Not enough resolved predictions to show trend
    </div>
  )

  const mus = points.map(p => p.mu)
  const sigmas = points.map(p => p.sigma)
  const yMin = Math.min(...mus.map((m, i) => m - sigmas[i])) - 10
  const yMax = Math.max(...mus.map((m, i) => m + sigmas[i])) + 10

  const xScale = (i: number) => (i / (points.length - 1)) * INNER_W
  const yScale = (v: number) => INNER_H - ((v - yMin) / (yMax - yMin)) * INNER_H

  // σ band path (top edge forward, bottom edge backward)
  const bandPath = [
    ...points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(p.mu + p.sigma).toFixed(1)}`),
    ...points.map((p, i) => `L${xScale(points.length - 1 - i).toFixed(1)},${yScale(points[points.length - 1 - i].mu - points[points.length - 1 - i].sigma).toFixed(1)}`),
    'Z',
  ].join(' ')

  const muPath = points.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(p.mu).toFixed(1)}`
  ).join(' ')

  // Y-axis tick values
  const tickCount = 4
  const ticks = Array.from({ length: tickCount }, (_, i) =>
    Math.round(yMin + (i / (tickCount - 1)) * (yMax - yMin))
  )

  // X-axis: first and last date labels
  const fmt = (d: string) => {
    const date = new Date(d)
    return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ maxHeight: H }}
      aria-label="Glicko-2 skill history"
    >
      <g transform={`translate(${PAD.left},${PAD.top})`}>
        {/* Grid lines */}
        {ticks.map(t => (
          <line
            key={t}
            x1={0} y1={yScale(t).toFixed(1)}
            x2={INNER_W} y2={yScale(t).toFixed(1)}
            stroke="#334155" strokeWidth={1}
          />
        ))}

        {/* σ band */}
        <path d={bandPath} fill="#3b82f6" fillOpacity={0.12} />

        {/* μ line */}
        <path d={muPath} fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinejoin="round" />

        {/* Last point dot */}
        <circle
          cx={xScale(points.length - 1).toFixed(1)}
          cy={yScale(points[points.length - 1].mu).toFixed(1)}
          r={3}
          fill="#3b82f6"
        />

        {/* Y-axis ticks + labels */}
        {ticks.map(t => (
          <text
            key={t}
            x={-6} y={yScale(t)}
            dominantBaseline="middle"
            textAnchor="end"
            fontSize={9}
            fill="#64748b"
          >
            {t}
          </text>
        ))}

        {/* X-axis labels */}
        <text x={0} y={INNER_H + 16} fontSize={9} fill="#64748b" textAnchor="start">
          {fmt(points[0].date)}
        </text>
        <text x={INNER_W} y={INNER_H + 16} fontSize={9} fill="#64748b" textAnchor="end">
          {fmt(points[points.length - 1].date)}
        </text>

        {/* Baseline at 1500 */}
        {yMin < 1500 && yMax > 1500 && (
          <line
            x1={0} y1={yScale(1500).toFixed(1)}
            x2={INNER_W} y2={yScale(1500).toFixed(1)}
            stroke="#64748b" strokeWidth={1} strokeDasharray="4,3"
          />
        )}
      </g>
    </svg>
  )
}

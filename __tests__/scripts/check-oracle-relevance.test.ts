// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// scripts/check-oracle-relevance.sh (daatan#2275) against logs rebuilt from the real per-hour
// POST /relevance counts in the Oracul's oracle_log.txt (read on the box 2026-11-26).

const SCRIPT = resolve(__dirname, '../../scripts/check-oracle-relevance.sh')
const ERR_TEXT =
  "litellm.UnsupportedParamsError: vertex_ai does not support parameters: ['temperature'], for model=gemini-3.5-flash-lite."

// [hour, 2xx, 502] — 2026-11-18 14:00 to 11-20 14:00 UTC: the retro#1090 outage (first 502 at
// 11-18 17:33:18, fix live 11-20 ~11:22).
const OUTAGE: Array<[string, number, number]> = [
  ['2026-11-18 14', 1752, 0], ['2026-11-18 15', 1626, 0], ['2026-11-18 16', 1738, 0],
  ['2026-11-18 17', 910, 838], ['2026-11-18 18', 0, 1904], ['2026-11-18 19', 0, 1899],
  ['2026-11-18 20', 0, 1871], ['2026-11-18 21', 0, 1882], ['2026-11-18 22', 0, 1893],
  ['2026-11-18 23', 0, 1772],
  ...[1735, 1820, 1775, 1792, 1799, 1843, 1894, 1851, 1835, 1874, 1799, 1902,
    1971, 1935, 1974, 1963, 1967, 1897, 1957, 1840, 1888, 1855, 1893, 1839]
    .map((n, h): [string, number, number] => [`2026-11-19 ${String(h).padStart(2, '0')}`, 0, n]),
  ...[1759, 1781, 1758, 1872, 1796, 1774, 1874, 1805, 1833, 1807, 1926]
    .map((n, h): [string, number, number] => [`2026-11-20 ${String(h).padStart(2, '0')}`, 0, n]),
  ['2026-11-20 11', 1288, 603], ['2026-11-20 12', 1986, 0], ['2026-11-20 13', 1997, 0],
  ['2026-11-20 14', 1857, 0],
]

// 2026-11-25, a normal day: one 5xx in 24h.
const NORMAL: Array<[string, number, number]> = [
  1711, 1782, 1731, 1748, 1636, 1811, 1808, 1794, 1803, 1863, 1817, 1791,
  1853, 1629, 1811, 1806, 1738, 1768, 1843, 1828, 1776, 1779, 1827, 1730,
].map((n, h) => [`2026-11-25 ${String(h).padStart(2, '0')}`, n, h === 15 ? 1 : 0])

// Each minute: the app's timestamped lines, then that minute's share of uvicorn access lines
// (which carry no timestamp), and a `relevance check failed` line when the minute had errors —
// the shape oracle_log.txt has.
function buildLog(hours: Array<[string, number, number]>): string {
  const out: string[] = []
  for (const [hour, ok, err] of hours) {
    for (let m = 0; m < 60; m++) {
      const mm = String(m).padStart(2, '0')
      out.push(`${hour}:${mm}:00,000 INFO tm.llm — event=prompt_cache_skipped_unsupported_model model=vertex_ai/gemini-3.5-flash-lite`)
      const okN = Math.floor((ok * (m + 1)) / 60) - Math.floor((ok * m) / 60)
      const errN = Math.floor((err * (m + 1)) / 60) - Math.floor((err * m) / 60)
      if (errN > 0) {
        out.push(`${hour}:${mm}:01,000 WARNING forecast_api.main — relevance check failed claim=Some claim err=${ERR_TEXT}`)
      }
      for (let i = 0; i < okN; i++) out.push('52.29.223.70:0 - "POST /relevance HTTP/1.1" 200')
      for (let i = 0; i < errN; i++) out.push('52.29.223.70:0 - "POST /relevance HTTP/1.1" 502')
      out.push('127.0.0.1:39390 - "GET /health HTTP/1.1" 200')
    }
  }
  return out.join('\n') + '\n'
}

type Verdict = {
  action: string; hour: string; err: number; ok: number; nbroken: number; nhours: number
  first: string; last: string; reason: string; status: string; top: string
}

let dir: string

function check(log: string, now: string, state = join(dir, 'state')): Verdict {
  const r = spawnSync('bash', [SCRIPT], {
    env: { ...process.env, TZ: 'UTC', ORACLE_LOG: log, REL_CHECK_NOW: now, REL_STATE: state },
    encoding: 'utf8',
  })
  expect(r.status).toBe(0)
  const line = r.stdout.trim().split('\n').find((l) => l.startsWith('REL|'))
  expect(line).toBeDefined()
  const [, action, hour, err, ok, nbroken, nhours, first, last, reason, status, top] = line!.split('|')
  return { action, hour, err: +err, ok: +ok, nbroken: +nbroken, nhours: +nhours, first, last, reason, status, top }
}

// Runs at :12 past each hour from `from` (inclusive) for `count` hours, sharing one state file.
// The first run has no state, so it checks the two hours before `from`: both must be in the log.
function hourlyRuns(log: string, from: string, count: number): Array<{ at: string; v: Verdict }> {
  const state = join(dir, `state-${from.replace(/\W/g, '')}-${count}`)
  const start = Date.parse(`${from.replace(' ', 'T')}:12:00Z`)
  return Array.from({ length: count }, (_, i) => {
    const at = new Date(start + i * 3600_000).toISOString().slice(0, 16).replace('T', ' ')
    return { at, v: check(log, at, state) }
  })
}

describe.skipIf(process.platform !== 'linux')('check-oracle-relevance.sh', () => {
  let outageLog: string
  let normalLog: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'rel-watchdog-'))
    outageLog = join(dir, 'outage.log')
    normalLog = join(dir, 'normal.log')
    writeFileSync(outageLog, buildLog(OUTAGE))
    writeFileSync(normalLog, buildLog(NORMAL))
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('alerts once on the first fully broken hour of the 11-18 outage, with the 502 and its cause', () => {
    // 17:00-18:00 was 48% errors (onset at 17:33), so it is not broken yet.
    expect(check(outageLog, '2026-11-18 18:12', join(dir, 's1')).action).toBe('ok')
    const v = check(outageLog, '2026-11-18 19:12', join(dir, 's1'))
    expect(v).toMatchObject({ action: 'alert', hour: '2026-11-18 18', err: 1904, ok: 0, reason: 'errors', status: '502' })
    expect(v.top).toContain('litellm.UnsupportedParamsError')
  })

  it('across the whole outage, hourly: one alert at onset, 6-hourly reminders, one recovery', () => {
    const runs = hourlyRuns(outageLog, '2026-11-18 16', 48)
    const said = runs.filter((r) => r.v.action !== 'ok').map((r) => `${r.at} ${r.v.action}`)
    expect(said).toEqual([
      '2026-11-18 19:12 alert',
      '2026-11-19 01:12 alert',
      '2026-11-19 07:12 alert',
      '2026-11-19 13:12 alert',
      '2026-11-19 19:12 alert',
      '2026-11-20 01:12 alert',
      '2026-11-20 07:12 alert',
      '2026-11-20 12:12 recovered',
    ])
  }, 30_000)

  it('an outage that starts and ends between two runs gives one blip', () => {
    // GitHub skips most hourly runs; here the run after 16:12 comes 45h later.
    const state = join(dir, 's-blip')
    expect(check(outageLog, '2026-11-18 16:12', state).action).toBe('ok')
    const v = check(outageLog, '2026-11-20 13:12', state)
    expect(v).toMatchObject({ action: 'blip', nhours: 12, nbroken: 10, first: '2026-11-20 01', last: '2026-11-20 10' })
  })

  it('a normal day, hourly, says nothing', () => {
    const runs = hourlyRuns(normalLog, '2026-11-25 02', 23)
    expect(runs.filter((r) => r.v.action !== 'ok')).toEqual([])
    expect(runs.every((r) => r.v.ok > 1500)).toBe(true)
  }, 30_000)

  it('a quiet hour is broken: the caller stopped or oracle-api stopped logging', () => {
    const quiet = join(dir, 'quiet.log')
    writeFileSync(quiet, buildLog([['2026-11-25 09', 1863, 0], ['2026-11-25 10', 1817, 0], ['2026-11-25 11', 0, 0], ['2026-11-25 12', 12, 0]]))
    const state = join(dir, 's-quiet')
    expect(check(quiet, '2026-11-25 11:12', state).action).toBe('ok')
    expect(check(quiet, '2026-11-25 12:12', state)).toMatchObject({ action: 'alert', reason: 'quiet', ok: 0, err: 0 })
    expect(check(quiet, '2026-11-25 13:12', state)).toMatchObject({ action: 'ok', reason: 'quiet', ok: 12 })
  })

  it('reports an unreadable log instead of a verdict', () => {
    expect(check(join(dir, 'missing.log'), '2026-11-25 12:12').action).toBe('error')
  })
})

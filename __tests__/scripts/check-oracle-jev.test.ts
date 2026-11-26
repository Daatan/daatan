// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// scripts/check-oracle-jev.sh (daatan#1792, #1796) against logs shaped like the Oracul's
// oracle_log.txt: `event=jev_gate` lines among timestamped app lines and untimestamped
// uvicorn access lines.

const SCRIPT = resolve(__dirname, '../../scripts/check-oracle-jev.sh')
const ERR_STATUS =
  "HTTPStatusError(\"Client error '402 Payment Required' for url 'https://openrouter.ai/api/v1/chat/completions'\")"

// [hour, jev ok, jev errors, other log lines per minute]
type Hour = [string, number, number, number]

function buildLog(hours: Hour[]): string {
  const out: string[] = []
  for (const [hour, ok, err, filler] of hours) {
    for (let m = 0; m < 60; m++) {
      const mm = String(m).padStart(2, '0')
      const okN = Math.floor((ok * (m + 1)) / 60) - Math.floor((ok * m) / 60)
      const errN = Math.floor((err * (m + 1)) / 60) - Math.floor((err * m) / 60)
      for (let i = 0; i < filler; i++) {
        out.push(i % 2
          ? '52.29.223.70:0 - "POST /relevance HTTP/1.1" 200'
          : `${hour}:${mm}:00,000 INFO tm.llm — event=prompt_cache_skipped_unsupported_model model=vertex_ai/gemini-3.5-flash-lite`)
      }
      for (let i = 0; i < okN; i++) {
        out.push(`${hour}:${mm}:30,000 INFO forecast_api.forecaster — event=jev_gate would_skip=False enforce=True max_noul=0.770 threshold=0.07 n_preds=3 status=ok late=False script=he language=he n_sents=17 jev_ms=522`)
      }
      for (let i = 0; i < errN; i++) {
        out.push(`${hour}:${mm}:31,000 INFO forecast_api.forecaster — event=jev_gate would_skip=False enforce=True max_noul=none threshold=0.07 n_preds=1 status=${ERR_STATUS} late=False script=latin language=en`)
      }
    }
  }
  return out.join('\n') + '\n'
}

const hoursOf = (day: string, from: number, to: number, ok: number, err: number, filler: number): Hour[] =>
  Array.from({ length: to - from + 1 }, (_, i) => [`${day} ${String(from + i).padStart(2, '0')}`, ok, err, filler])

type Verdict = {
  action: string; hour: string; err: number; ok: number; nbroken: number; nhours: number
  first: string; last: string; top: string
}

let dir: string

function check(log: string, now: string, state: string): Verdict {
  const r = spawnSync('bash', [SCRIPT], {
    env: { ...process.env, TZ: 'UTC', ORACLE_LOG: log, JEV_CHECK_NOW: now, JEV_STATE: state },
    encoding: 'utf8',
  })
  expect(r.status).toBe(0)
  const line = r.stdout.trim().split('\n').find((l) => l.startsWith('JEV|'))
  expect(line).toBeDefined()
  const [, action, hour, err, ok, nbroken, nhours, first, last, top] = line!.split('|')
  return { action, hour, err: +err, ok: +ok, nbroken: +nbroken, nhours: +nhours, first, last, top }
}

describe.skipIf(process.platform !== 'linux')('check-oracle-jev.sh', () => {
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'jev-watchdog-')) })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('reads the earliest hours of a 12h look-back even at outage log volume', () => {
    // 40k lines an hour, about the 11-18/20 /relevance outage rate. The nine hours after the
    // broken ones hold 360k lines: a fixed `tail -n 300000` never reached 06:00-08:00.
    const log = join(dir, 'busy.log')
    writeFileSync(log, buildLog([
      ...hoursOf('2026-11-18', 3, 5, 5, 0, 667),
      ...hoursOf('2026-11-18', 6, 8, 0, 6, 667),
      ...hoursOf('2026-11-18', 9, 17, 5, 0, 667),
    ]))
    // Previous check covered up to 05:00; the next one comes 12h later.
    const state = join(dir, 's-busy')
    writeFileSync(state, `state=ok\nlast_hour=${Date.parse('2026-11-18T05:00:00Z') / 1000}\nlast_alert=0\n`)
    const v = check(log, '2026-11-18 18:12', state)
    expect(v).toMatchObject({
      action: 'blip', hour: '2026-11-18 17', ok: 5, nhours: 12, nbroken: 3,
      first: '2026-11-18 06', last: '2026-11-18 08',
    })
    expect(v.top).toContain('402 Payment Required')
  }, 30_000)

  it('still reads the whole window, and nothing before it', () => {
    const log = join(dir, 'older.log')
    writeFileSync(log, buildLog([
      ...hoursOf('2026-11-18', 0, 2, 0, 6, 20),
      ...hoursOf('2026-11-18', 3, 4, 7, 0, 20),
    ]))
    // No state: the two hours before now, 03:00 and 04:00.
    expect(check(log, '2026-11-18 05:12', join(dir, 's-older'))).toMatchObject({
      action: 'ok', hour: '2026-11-18 04', ok: 7, err: 0, nhours: 2, nbroken: 0,
    })
  })

  it('alerts once, stays quiet while still broken, then recovers', () => {
    const log = join(dir, 'outage.log')
    writeFileSync(log, buildLog([
      ...hoursOf('2026-11-18', 1, 3, 0, 6, 20),
      ...hoursOf('2026-11-18', 4, 4, 5, 0, 20),
    ]))
    const state = join(dir, 's-outage')
    expect(check(log, '2026-11-18 03:12', state)).toMatchObject({ action: 'alert', hour: '2026-11-18 02', err: 6 })
    expect(check(log, '2026-11-18 04:12', state)).toMatchObject({ action: 'ok', hour: '2026-11-18 03', err: 6 })
    expect(check(log, '2026-11-18 05:12', state)).toMatchObject({ action: 'recovered', hour: '2026-11-18 04', ok: 5 })
  })

  it('judges the latest hour that had calls when the last one was quiet', () => {
    const log = join(dir, 'quiet.log')
    writeFileSync(log, buildLog([['2026-11-18 01', 0, 6, 20], ['2026-11-18 02', 0, 0, 20]]))
    expect(check(log, '2026-11-18 03:12', join(dir, 's-quiet'))).toMatchObject({
      action: 'alert', hour: '2026-11-18 01', err: 6,
    })
  })

  it('reports an unreadable log instead of a verdict', () => {
    expect(check(join(dir, 'missing.log'), '2026-11-18 05:12', join(dir, 's-missing')).action).toBe('error')
  })
})

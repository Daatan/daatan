// Per-device timing estimates for the forecast-submission progress UI.
// Stored in localStorage and refined after each run so the ETA adapts to how
// fast this browser/device actually is. No server/DB involvement.

const DEFAULTS = {
  // The create call is dominated by the content-moderation LLM call.
  'forecast-create': 5000,
  // The publish call is a DB write + a fire-and-forget Telegram notify.
  'forecast-publish': 1500,
  // resolvePrediction's two DB-transaction phases (daatan#1139): per-commitment
  // Brier/RS/Glicko-2 scoring, then ELO + per-tag rating write-back. Both scale
  // with commitment count, so these defaults (from the previous hardcoded
  // estimate) get refined fast once real per-forecast durations come in.
  'resolve-scoring': 1200,
  'resolve-updating': 800,
} as const

export type TimingKey = keyof typeof DEFAULTS

const STORAGE_PREFIX = 'daatan:timing:'

export function getEstimate(key: TimingKey): number {
  if (typeof window === 'undefined') return DEFAULTS[key]
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key)
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) && n > 0 ? n : DEFAULTS[key]
  } catch {
    return DEFAULTS[key]
  }
}

export function recordDuration(key: TimingKey, ms: number): void {
  if (typeof window === 'undefined' || !Number.isFinite(ms) || ms <= 0) return
  try {
    const prev = getEstimate(key)
    // EWMA: adapt toward the latest sample while smoothing one-off spikes.
    const next = Math.round(prev * 0.6 + ms * 0.4)
    window.localStorage.setItem(STORAGE_PREFIX + key, String(next))
  } catch {
    // localStorage unavailable — estimates simply stay at the defaults.
  }
}

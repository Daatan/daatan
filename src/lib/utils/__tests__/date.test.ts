import { describe, it, expect } from 'vitest'
import { formatDdmmyyyy, parseDdmmyyyy, parseTime24 } from '../date'

describe('formatDdmmyyyy', () => {
  it('converts YYYY-MM-DD to DD/MM/YYYY', () => {
    expect(formatDdmmyyyy('2026-12-31')).toBe('31/12/2026')
    expect(formatDdmmyyyy('2027-01-05')).toBe('05/01/2027')
  })

  it('returns empty string for non-YYYY-MM-DD input', () => {
    expect(formatDdmmyyyy('')).toBe('')
    expect(formatDdmmyyyy('31/12/2026')).toBe('')
    expect(formatDdmmyyyy('2026-12-31T23:59')).toBe('')
  })
})

describe('parseDdmmyyyy', () => {
  it('parses day-first dates to YYYY-MM-DD', () => {
    expect(parseDdmmyyyy('31/12/2026')).toBe('2026-12-31')
    expect(parseDdmmyyyy('1/2/2026')).toBe('2026-02-01')
  })

  it('accepts dot and dash separators', () => {
    expect(parseDdmmyyyy('31.12.2026')).toBe('2026-12-31')
    expect(parseDdmmyyyy('31-12-2026')).toBe('2026-12-31')
  })

  it('ignores surrounding whitespace', () => {
    expect(parseDdmmyyyy(' 31/12/2026 ')).toBe('2026-12-31')
  })

  it('rejects impossible calendar dates instead of rolling them over', () => {
    expect(parseDdmmyyyy('31/02/2026')).toBeNull()
    expect(parseDdmmyyyy('29/02/2027')).toBeNull() // not a leap year
    expect(parseDdmmyyyy('29/02/2028')).toBe('2028-02-29') // leap year
  })

  it('rejects month-first (American) input where the month is impossible', () => {
    expect(parseDdmmyyyy('12/31/2026')).toBeNull()
  })

  it('rejects incomplete or malformed input', () => {
    expect(parseDdmmyyyy('')).toBeNull()
    expect(parseDdmmyyyy('6')).toBeNull()
    expect(parseDdmmyyyy('31/12')).toBeNull()
    expect(parseDdmmyyyy('31/12/26')).toBeNull() // 2-digit year
    expect(parseDdmmyyyy('2026-12-31')).toBeNull() // ISO order not accepted here
  })
})

describe('parseTime24', () => {
  it('parses and zero-pads 24-hour times', () => {
    expect(parseTime24('9:05')).toBe('09:05')
    expect(parseTime24('18:30')).toBe('18:30')
    expect(parseTime24('00:00')).toBe('00:00')
    expect(parseTime24('23:59')).toBe('23:59')
  })

  it('rejects out-of-range and malformed times', () => {
    expect(parseTime24('24:00')).toBeNull()
    expect(parseTime24('12:60')).toBeNull()
    expect(parseTime24('1230')).toBeNull()
    expect(parseTime24('12')).toBeNull()
    expect(parseTime24('')).toBeNull()
    expect(parseTime24('6:5')).toBeNull() // minutes must be 2 digits
  })
})

/** A YYYY-MM-DD day in the reader's locale, read as UTC so it never shifts a day. */
export function formatDay(day: string, locale: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, { dateStyle: 'medium', timeZone: 'UTC' })
}

/** 0..1 → whole percent. */
export function percent(p: number): number {
  return Math.round(p * 100)
}

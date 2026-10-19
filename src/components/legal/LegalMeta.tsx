import { LEGAL_LAST_UPDATED } from './version'

export default function LegalMeta() {
  return (
    <p className="text-sm text-text-secondary/80">
      Last updated: <time dateTime={LEGAL_LAST_UPDATED}>{LEGAL_LAST_UPDATED}</time>
    </p>
  )
}

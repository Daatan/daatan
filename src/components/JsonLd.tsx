import { jsonLdSafe } from '@/lib/jsonLd'

/**
 * The single blessed sink for JSON-LD structured data. The payload is escaped
 * by `jsonLdSafe` so user-controlled fields (forecast claims, display names…)
 * cannot break out of the `<script>` tag and inject markup (stored XSS).
 *
 * Never hand-write `dangerouslySetInnerHTML={{ __html: JSON.stringify(...) }}`
 * — an ESLint rule forbids it. Render structured data through this component.
 */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdSafe(data) }}
    />
  )
}

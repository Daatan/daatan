/**
 * Serialize a value as JSON that is safe to embed inside an HTML `<script>`
 * element.
 *
 * `JSON.stringify` escapes JSON metacharacters but NOT the HTML-significant
 * `<`, `>`, `&` — so a value containing the literal `</script>` (e.g. a
 * user-supplied forecast claim or display name) would terminate the script
 * element and allow arbitrary markup/script to execute (stored XSS). The
 * U+2028 / U+2029 line separators are additionally illegal in raw JS string
 * literals and can break inline parsing.
 *
 * Escaping these as `\uXXXX` keeps the JSON byte-for-byte equivalent for any
 * JSON parser (so search engines still read the structured data), while making
 * it impossible to break out of the surrounding `<script>` tag.
 *
 * Prefer the `<JsonLd>` component over calling this directly; it is the single
 * blessed sink for JSON-LD. An ESLint rule forbids hand-rolling
 * `dangerouslySetInnerHTML={{ __html: JSON.stringify(...) }}`.
 */
export function jsonLdSafe(data: unknown): string {
  // U+2028 / U+2029 are matched via fromCharCode so the (invisible) separator
  // characters are never embedded in this source file.
  const lineSep = String.fromCharCode(0x2028)
  const paraSep = String.fromCharCode(0x2029)
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .split(lineSep)
    .join('\\u2028')
    .split(paraSep)
    .join('\\u2029')
}

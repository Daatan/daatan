import type { SearchResult } from '@/lib/services/oracleSearch'

/**
 * Strip common English stopwords and future-tense helpers from a claim to get
 * a tighter keyword query. E.g. "The Israeli Shekel will strengthen against the
 * US Dollar by the end of February 24, 2026" → "Israeli Shekel strengthen US
 * Dollar February 2026"
 */
export function extractKeyTerms(claimText: string, resolveByDatetime: Date): string {
    const stopwords = new Set([
        'the', 'a', 'an', 'will', 'would', 'should', 'could', 'may', 'might',
        'by', 'against', 'of', 'end', 'to', 'in', 'on', 'at', 'and', 'or',
        'be', 'is', 'are', 'was', 'were', 'that', 'this', 'it', 'its',
        'have', 'has', 'had', 'do', 'does', 'did', 'not', 'for', 'with',
        'from', 'up', 'about', 'into', 'than', 'then', 'so', 'if', 'as',
    ])
    const year = resolveByDatetime.getFullYear()
    const terms = claimText
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopwords.has(w.toLowerCase()))
        .join(' ')
    // Append year only if not already present in the terms
    return terms.includes(String(year)) ? terms : `${terms} ${year}`
}

export function dedup(items: SearchResult[]): SearchResult[] {
    const seen = new Set<string>()
    return items.filter(r => {
        if (seen.has(r.url)) return false
        seen.add(r.url)
        return true
    })
}

/**
 * Compose the final research result list from the three search legs, reserving
 * slots per leg so no leg starves another (daatan#1515): a flat
 * append-then-cap let the deadline-window legs fill the whole cap, leaving the
 * born-true pre-creation leg (daatan#1511) at most one surviving snippet.
 *
 * Priority order: primary, then pre-creation (capped at `caps.preCreation`),
 * then deadline-targeted filling the remainder up to `caps.total`. The primary
 * leg already covers the deadline window, so when the total cap bites it bites
 * the leg with the most redundancy. Pre-creation results duplicating a primary
 * URL don't consume a reserved slot.
 */
export function composeResearchResults(
    primary: SearchResult[],
    preCreation: SearchResult[],
    deadlineTargeted: SearchResult[],
    caps: { preCreation: number; total: number },
): SearchResult[] {
    const primaryUrls = new Set(primary.map(r => r.url))
    const reservedPre = dedup(preCreation)
        .filter(r => !primaryUrls.has(r.url))
        .slice(0, caps.preCreation)
    return dedup([...primary, ...reservedPre, ...deadlineTargeted]).slice(0, caps.total)
}

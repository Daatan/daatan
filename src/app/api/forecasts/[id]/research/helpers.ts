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

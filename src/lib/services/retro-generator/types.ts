/** One reported-fact claim from the evidence pool: what an article said happened. */
export interface PoolReport {
  url: string
  /** Outlet/domain as the pool stored it. */
  source: string | null
  /** As the source reported it; not always ISO (see `EvidencePoolArticle.publishedDate`). */
  publishedDate: string | null
  claim: string
  quote: string | null
}

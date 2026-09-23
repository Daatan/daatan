export type Group = 'west' | 'analysts' | 'ua' | 'ru'
export type Region = 'west' | 'ua' | 'ru'
export type Side = 'invasion' | 'uncertain' | 'no_invasion'

export interface PoolRow {
  d: string
  p: number
  s: 'i' | 'u' | 'n'
  g: Group
  r: Region
}

export interface ReportRow {
  n: number
  date: string
  domain: string
  title: string | null
  url: string
  article_kind: string | null
  voice_name: string | null
  voice_affiliation: string | null
  claim_strength: number | null
  predicted_scope: string | null
  timeframe: string | null
  p_full: number
  score: number
  side: Side
  key_quote: string | null
  key_quote_en: string | null
  summary: string | null
  quote_verified: boolean
  text_source: string | null
  g: Group
  reg: Region
}

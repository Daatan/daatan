export type Group = 'polls' | 'media' | 'bloc' | 'anti'
export type Region = 'he' | 'il_en' | 'ru' | 'ar' | 'intl'
export type Side = 'bloc61' | 'uncertain' | 'no61'

export interface PoolRow {
  d: string
  p: number
  s: Side
  g: Group
  r: Region
}

export interface PollSeats {
  d: string
  s: number
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
  projected_bloc_seats: number | null
  claim_strength: number | null
  no61_kind: string | null
  p61: number
  side: Side
  key_quote: string | null
  key_quote_en: string | null
  summary: string | null
  quote_verified: boolean
  text_source: string | null
  g: Group
  reg: Region
}

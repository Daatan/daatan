export type Group = 'banks' | 'agencies' | 'insiders' | 'press'
export type Region = 'en' | 'ru' | 'eu' | 'ar'
export type Leg = 'brent' | 'ttf'
export type Side = 'high' | 'uncertain' | 'low'

export interface PoolRow {
  d: string
  pb: number | null
  pt: number | null
  g: Group
  r: Region
}

export interface ReportRow {
  n: number
  date: string
  domain: string
  url: string
  title: string | null
  article_kind: string | null
  voice_name: string | null
  voice_affiliation: string | null
  g: Group
  reg: Region
  p_brent: number | null
  p_ttf: number | null
  price_brent: number | null
  price_ttf: number | null
  key_quote: string | null
  key_quote_en: string | null
  summary: string | null
  quote_verified: boolean
  text_source: string | null
  claim_strength: number | null
  horizon: string | null
}

export type PriceSeries = [string, number][]
export interface Prices {
  brent: PriceSeries
  ttf: PriceSeries
}

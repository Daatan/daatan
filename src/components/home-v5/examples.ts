/**
 * The two example cards on the home-v5 page. This is the ONLY file to edit to change them.
 *
 * - Forecast card: set FEATURED_FORECAST_ID to the id (or slug) of any public forecast. The text,
 *   tags, probability and date are read live from the database in the visitor's language
 *   (cached translations only — falls back to the English text). Set it to null to hide the card.
 *   The card also hides itself if the forecast is missing, not public, or has no AI estimate.
 * - Source card: edit FEATURED_SOURCE below (all text is written by hand, per language, because
 *   per-statement verdicts are not in the live data). Set it to null to hide the card.
 */
import type { Locale } from '@/i18n/config'

export const FEATURED_FORECAST_ID: string | null = 'cmskq8dzl00a601plb2lt21dk'

type PerLocale = Record<Locale, string>

export interface FeaturedSource {
  name: PerLocale
  role: PerLocale
  /** ISO date the statement was made. */
  saidOn: string
  statement: PerLocale
  whatHappened: PerLocale
  verdict: 'correct' | 'wrong'
  /** Label of the field the record is counted in. */
  tag: PerLocale
  /** Resolved calls in that field, oldest first; true = correct. */
  record: boolean[]
}

/**
 * Retro-analysis case "Ukraine 2022" (src/app/retroanalysis/ukraine-2022/rows.json, row n=1,
 * interfax.ru, quote verified). The Russian quote is verbatim; English is `key_quote_en` from the
 * same row; Hebrew and Esperanto are translations of that sentence — have a native speaker confirm.
 */
export const FEATURED_SOURCE: FeaturedSource | null = {
  name: {
    en: 'Kyrylo Budanov',
    he: 'קירילו בודאנוב',
    ru: 'Кирилл Буданов',
    eo: 'Kyrylo Budanov',
  },
  role: {
    en: 'Head of Ukrainian military intelligence (GUR)',
    he: 'ראש המודיעין הצבאי של אוקראינה (GUR)',
    ru: 'Глава Главного управления разведки Украины (ГУР)',
    eo: 'Estro de la militara spionado de Ukrainio (GUR)',
  },
  saidOn: '2021-11-21',
  statement: {
    en: 'Russia has concentrated more than 92,000 military personnel at Ukraine’s borders and is preparing for an attack in late January or early February 2022.',
    he: 'רוסיה ריכזה בגבולות אוקראינה יותר מ-92 אלף חיילים ומתכוננת לתקיפה בסוף ינואר או בתחילת פברואר 2022.',
    ru: 'Россия сосредоточила у границ Украины более 92 тыс. военнослужащих и готовится к нападению в конце января или начале февраля 2022 года.',
    eo: 'Rusio koncentris ĉe la limoj de Ukrainio pli ol 92 mil militistojn kaj pretiĝas por atako fine de januaro aŭ komence de februaro 2022.',
  },
  whatHappened: {
    en: 'On 24 February 2022 Russia launched a full-scale invasion: the scale was right, the timing came about three weeks later.',
    he: 'ב-24 בפברואר 2022 רוסיה פתחה בפלישה רחבת היקף: ההיקף היה נכון, והמועד התאחר בכשלושה שבועות.',
    ru: '24 февраля 2022 года Россия начала полномасштабное вторжение: масштаб назван верно, срок оказался примерно на три недели позже.',
    eo: 'La 24-an de februaro 2022 Rusio komencis plenskalan invadon: la skalo ĝustis, la tempo venis ĉirkaŭ tri semajnojn pli malfrue.',
  },
  verdict: 'correct',
  tag: {
    en: 'Ukraine 2022',
    he: 'אוקראינה 2022',
    ru: 'Украина 2022',
    eo: 'Ukrainio 2022',
  },
  record: [true],
}

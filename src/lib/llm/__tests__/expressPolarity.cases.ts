/**
 * Polarity regression set for the express draft (#1807). Used by the live harness
 * scripts/check-express-polarity.ts. Each input is what an author typed; the draft
 * claim must assert the same direction (a "won't happen" input stays a "will not"
 * claim). `negated` marks inputs whose author predicts that something will NOT happen.
 */
export interface PolarityCase {
  id: string
  input: string
  negated: boolean
}

export const POLARITY_CASES: PolarityCase[] = [
  { id: "he-neg-peles", negated: true, input: "קרן פלס לא תכתוב את השיר לאירוויזיון  2027" },
  { id: "he-aff-peles", negated: false, input: "קרן פלס תכתוב את השיר לאירוויזיון 2027" },
  { id: "he-neg-ceasefire", negated: true, input: "לא תהיה הפסקת אש בעזה עד סוף השנה" },
  { id: "he-neg-elections", negated: true, input: "הבחירות לכנסת לא יוקדמו" },
  { id: "he-aff-bibi", negated: false, input: "נתניהו ינצח בבחירות הבאות" },
  { id: "he-neg-bibi", negated: true, input: "נתניהו לא יהיה ראש הממשלה אחרי הבחירות הבאות" },
  { id: "he-cond", negated: false, input: "אם גנץ יצטרף לקואליציה, הממשלה תשרוד עד 2027" },
  { id: "he-deadline", negated: false, input: "הדולר ירד מתחת ל-3.3 שקלים עד מרץ 2027" },
  { id: "he-neg-deadline", negated: true, input: "בנק ישראל לא יוריד את הריבית לפני יוני 2027" },
  { id: "ru-neg-putin", negated: true, input: "Путин не встретится с Зеленским в 2026 году" },
  { id: "ru-aff-btc", negated: false, input: "Биткоин превысит 200 тысяч долларов до конца 2026" },
  { id: "ru-neg-war", negated: true, input: "Война в Украине не закончится до конца 2026 года" },
  { id: "ru-neg-noone", negated: true, input: "Ни одна страна ЕС не выйдет из евро до 2028" },
  { id: "ru-cond", negated: false, input: "Если Трамп введёт пошлины на ЕС, евро упадёт ниже 1.05 к доллару до лета 2027" },
  { id: "ru-deadline", negated: false, input: "SpaceX запустит Starship на орбиту Марса к декабрю 2026" },
  { id: "ru-double-neg", negated: false, input: "Не исключено, что ФРС не будет снижать ставку — нет, скажу так: ФРС снизит ставку до марта 2027" },
]

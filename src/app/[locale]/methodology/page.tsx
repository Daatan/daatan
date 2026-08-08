import type { Metadata } from 'next'
import { Calculator } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAppUrl } from '@/lib/branding'

export const metadata: Metadata = {
  title: 'שיטת הניקוד של דעתן',
  alternates: { canonical: `${getAppUrl()}/he/methodology` },
}

export default async function LocaleMethodologyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (locale !== 'he') redirect('/methodology')

  return (
    <div dir="rtl" className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6 lg:mb-8">
        <Calculator className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500" />
        <h1 className="text-2xl sm:text-3xl font-bold text-white">שיטת הניקוד של דעתן</h1>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">בקצרה</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            דעתן מדרג מתחזתים לפי אחת עשרה שיטות ניקוד שונות, וכל אחת בודקת היבט אחר של יכולת
            חיזוי: דיוק גולמי, כיול (Brier Score), עוצמה מול יריב (ELO), ורמת ביטחון מותאמת אי-ודאות
            (Glicko-2). כל שיטה, חוץ מ&quot;ניקוד המוניטין&quot; המקורי, אפשר לסנן לפי נושא אחד בלוח
            המובילים.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Brier Score — כיול</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            מודד עד כמה רמת הביטחון שהמשתמש הצהיר עליה תואמת את מה שקרה בפועל: המרחק בריבוע בין
            ההסתברות שהמשתמש נתן לבין התוצאה בפועל. ככל שהניקוד נמוך יותר — כך טוב יותר; חיזוי
            מושלם מקבל ניקוד 0.
          </p>
          <p className="font-mono text-amber-300 bg-navy-800 rounded-lg p-3 text-sm">
            brierScore = (הסתברות − תוצאה)²
          </p>
          <p>
            לדוגמה: משתמש שהעריך 75% שתחזית תתממש, וזה אכן קרה — מקבל ניקוד (0.75−1)² = 0.0625.
            אילו זה לא היה קורה, הניקוד היה (0.75−0)² = 0.5625 — פי תשעה יותר גרוע, כי ביטחון
            גבוה וטעות נענשים באופן ריבועי.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">דירוג ELO — עוצמה מול יריב</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            כששני משתמשים מתחייבים לאותה תחזית, מי שקרוב יותר לאמת (ניקוד Brier נמוך יותר) לוקח
            נקודות ELO מהשני — אותה שיטה המשמשת בשחמט. ככל שהדירוג גבוה יותר — כך טוב יותר.
          </p>
          <p>
            לדוגמה: משתמש בדירוג 1500 מנצח משתמש בדירוג 1600 — הוא מרוויח כ-20.5 נקודות ועולה
            ל-1520.5. אילו הפסיד, היה מאבד רק כ-11.5 נקודות — הפסד ליריב חזק יותר עולה פחות.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Glicko-2 — מיומנות מותאמת אי-ודאות</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            Glicko-2 עוקב לא רק אחרי הערכת המיומנות (μ) אלא גם אחרי רמת אי-הוודאות של המערכת
            לגביה (σ). לוח המובילים מדרג לפי μ − 3σ — רף שמרני, לא ההערכה הגולמית — כדי שניחוש
            אחד מוצלח לא יוכל להקדים מתחזת ותיק ועקבי. כל משתמש מתחיל ב-μ=1500, σ=350.
          </p>
          <p>
            לדוגמה: משתמש חדש שמבצע תחזית אחת נכונה ובטוחה (Brier Score 0.04) מגיע ל-μ≈1649,
            σ≈290 — כלומר דירוג של μ−3σ ≈ 778, עדיין <strong>מתחת</strong> לנקודת ההתחלה (1500).
            רק ככל שיצטברו עוד תחזיות נכונות ו-σ יקטן, הדירוג האמיתי יתחיל לעלות. זו בדיוק
            הערבות של Glicko-2: נפח ועקביות מנצחים ניחוש בודד, מוצלח ככל שיהיה.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">שיטות ניקוד נוספות</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            מעבר לשלוש השיטות המרכזיות, דעתן עוקב גם אחרי: ניקוד מוניטין (RS) — הניקוד המקורי,
            לפי תחזיות נכונות במשקל רמת הביטחון; דיוק (Accuracy) — אחוז התחזיות שהתממשו; מספר
            תחזיות נכונות; סך יחידות הביטחון (CU) שהושקעו; ניקוד עמיתים (Peer Score) ו&quot;ניקוד
            AI&quot; — כמה יותר מדויק המשתמש מהקהילה או מה-AI; TruthScore — עקביות היכולת לנצח את
            הקהילה; ROI — שינוי ממוצע בניקוד המוניטין לכל תחזית; וניקוד עמיתים משוקלל-זמן, בהשראת
            Metaculus, שנותן משקל גבוה יותר לתחזיות עדכניות.
          </p>
          <p>
            כל השיטות האלה, חוץ מניקוד המוניטין הגלובלי, ניתנות לסינון לפי נושא ב
            <Link href="/leaderboard" className="text-blue-400 hover:text-blue-300 underline">
              {' '}לוח המובילים
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  )
}

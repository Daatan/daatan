import type { Metadata } from 'next'
import { Info } from 'lucide-react'

export const metadata: Metadata = {
  title: 'על דעתן',
  alternates: { canonical: 'https://daatan.com/he/about' },
}

export default function LocaleAboutPage() {
  return (
    <div dir="rtl" className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6 lg:mb-8">
        <Info className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500" />
        <h1 className="text-2xl sm:text-3xl font-bold text-white">על דעתן</h1>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">מה זה דעתן?</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>דעתן הוא מקום שבו דעות על העתיד הופכות לתחזיות שאפשר לבדוק.</p>
          <p>
            במקום רק להגיד &quot;נראה לי שיקרה משהו&quot;, כותבים בדעתן טענה ברורה על העתיד. המערכת
            עוזרת להפוך אותה לתחזית מדידה: עם ניסוח מסודר, תאריך הכרעה, אפשרויות תוצאה וכללי
            הכרעה ברורים. המשתמש לא צריך לבנות לבד את כל המבנה, אלא לומר בצורה ברורה מה לדעתו
            צפוי לקרות. משם, דעתן הופך את זה למשהו שאפשר לבדוק לאורך זמן.
          </p>
          <p>
            כשהמועד מגיע, התחזית נבדקת ומוכרעת. כך, תחזית אחר תחזית, נבנה רקורד שמראה מי ידע
            לקרוא את המציאות, באילו תחומים, ובאיזו רמת ביטחון.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">מה עושים כאן?</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            בדעתן אפשר ליצור תחזיות משלך, להשתתף בתחזיות של אחרים, ולראות מה הקהילה חושבת על
            שאלות פתוחות.
          </p>
          <p>
            כל תחזית היא הזמנה לקחת עמדה: האם זה יקרה או לא יקרה, ובאיזו רמת ביטחון. אפשר לעקוב
            אחרי תחזיות פתוחות, לראות איפה יש הסכמה או מחלוקת, ולגלות אילו אנשים מדייקים לאורך
            זמן.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">איך תחזית עובדת?</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>כל תחזית בדעתן בנויה משלושה דברים פשוטים:</p>
          <p>מה צפוי לקרות, עד מתי זה אמור לקרות, ובאיזו רמת ביטחון המשתמשים מעריכים שזה יקרה.</p>
          <p className="font-medium text-white">לדוגמה:</p>
          <p>
            עד 31 בדצמבר 2026, OpenAI תשיק מודל חדש תחת השם GPT-6.
          </p>
          <p>
            במקרה כזה ברור מה בודקים: האם המודל הושק עד התאריך שנקבע. כל משתמש יכול לבחור אם
            לדעתו זה יקרה או לא יקרה, ולהוסיף את רמת הביטחון שלו.
          </p>
          <p>
            כשהמועד מגיע, התחזית מוכרעת, והתוצאה נכנסת לרקורד של כל מי שהשתתף בה.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">מה נבנה לאורך זמן?</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            הרקורד האישי בדעתן נבנה מתחזיות שהמשתמש השתתף בהן והוכרעו. בכל פעם שמשתמש בוחר אם
            תחזית תקרה או לא תקרה, מוסיף רמת ביטחון, והתחזית מוכרעת, התוצאה נכנסת לרקורד שלו.
          </p>
          <p>
            הרקורד לא נבנה רק כמספר כללי אחד. הוא נבנה גם לפי תחומים. כך יכול להיות שלמשתמש
            יהיה רקורד חזק בפוליטיקה עולמית, רקורד חלש יותר בכדורסל ישראלי, ורקורד אחר לגמרי
            בטכנולוגיה או בכלכלה.
          </p>
          <p>
            לאורך זמן, דעתן מאפשר לראות לא רק מי צדק, אלא איפה שיקול הדעת שלו חזק יותר, ואיפה
            הביטחון שלו היה גבוה מדי או נמוך מדי.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">למי זה מתאים?</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            דעתן מתאים לאנשים שאוהבים לחשוב קדימה: על פוליטיקה, כלכלה, טכנולוגיה, ספורט, תרבות,
            חברה, חדשות וכל תחום שבו יש שאלות פתוחות לגבי העתיד.
          </p>
          <p>
            הוא מתאים למי שרוצה לבדוק את שיקול הדעת שלו לאורך זמן, וגם למי שרוצה להבין על מי
            אפשר לסמוך יותר בכל תחום ותחום. לא לפי מי נשמע הכי בטוח או מתנסח הכי יפה, אלא לפי מי
            בנה רקורד של תחזיות שנבדקו והוכרעו בפועל.
          </p>
          <p>בדעתן, דעה על העתיד לא נשארת רק אמירה. היא מצטרפת לרקורד.</p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">מי עומד מאחורי דעתן?</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            דעתן נבנה על ידי{' '}
            <span className="text-white font-medium">אנדרי בר ומאריק קאן</span>
            , שני יזמים ישראלים שמתעניינים בטכנולוגיה, שיח ציבורי, תחזיות וקבלת החלטות, מתוך
            רצון ליצור מקום שבו תחזיות, דעות וטענות לגבי העתיד לא נעלמות אחרי כמה ימים, אלא
            נבדקות לאורך זמן.
          </p>
          <p>
            המטרה שלנו היא לבנות כלי נגיש, מעניין ורציני, שבו אנשים יכולים לפתח רקורד של שיקול
            דעת בתחומים שונים, וגם לראות את הרקורד של אחרים: מי דייק בעבר, באילו תחומים, ועל מי
            אפשר לסמוך יותר כשמנסים להבין מה צפוי לקרות.
          </p>
        </div>
      </div>
    </div>
  )
}

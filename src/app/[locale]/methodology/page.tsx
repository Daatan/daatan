import type { Metadata } from 'next'
import { Calculator } from 'lucide-react'
import Link from 'next/link'
import { getAppUrl } from '@/lib/branding'

const TITLES: Record<string, string> = {
  he: 'שיטת הניקוד של דעתן',
  ru: 'Методика подсчёта очков Daatan',
  eo: 'La poentado-metodo de Daatan',
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const appUrl = getAppUrl()
  return {
    title: TITLES[locale] ?? TITLES.he,
    alternates: {
      canonical: `${appUrl}/${locale}/methodology`,
      languages: {
        'x-default': `${appUrl}/methodology`,
        en: `${appUrl}/methodology`,
        he: `${appUrl}/he/methodology`,
        ru: `${appUrl}/ru/methodology`,
      },
    },
  }
}

export default async function LocaleMethodologyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params

  if (locale === 'ru') return <RuMethodologyPage />
  if (locale === 'eo') return <EoMethodologyPage />
  return <HeMethodologyPage />
}

function HeMethodologyPage() {
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

function RuMethodologyPage() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6 lg:mb-8">
        <Calculator className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500" />
        <h1 className="text-2xl sm:text-3xl font-bold text-white">Методика подсчёта очков Daatan</h1>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Вкратце</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            Daatan ранжирует прогнозистов по одиннадцати разным системам подсчёта очков, каждая
            из которых проверяет свой аспект способности прогнозировать: точность, калибровку
            (Brier Score), силу относительно соперника (ELO) и степень уверенности с учётом
            неопределённости (Glicko-2). Любую систему, кроме исходного «рейтинга репутации»,
            можно отфильтровать по одной теме в таблице лидеров.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Brier Score — калибровка</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            Измеряет, насколько заявленная пользователем степень уверенности соответствует тому,
            что произошло на самом деле: квадрат расстояния между вероятностью, которую указал
            пользователь, и фактическим результатом. Чем ниже балл — тем лучше; идеальный прогноз
            получает 0 баллов.
          </p>
          <p className="font-mono text-amber-300 bg-navy-800 rounded-lg p-3 text-sm">
            brierScore = (вероятность − результат)²
          </p>
          <p>
            Например: пользователь оценил вероятность в 75%, что прогноз сбудется, и это
            действительно произошло — он получает балл (0,75−1)² = 0,0625. Если бы это не
            произошло, балл был бы (0,75−0)² = 0,5625 — в девять раз хуже, потому что высокая
            уверенность и ошибка наказываются квадратично.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Рейтинг ELO — сила относительно соперника</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            Когда два пользователя делают ставку на один и тот же прогноз, тот, кто ближе к
            истине (у кого ниже Brier Score), забирает очки ELO у другого — та же система, что
            используется в шахматах. Чем выше рейтинг — тем лучше.
          </p>
          <p>
            Например: пользователь с рейтингом 1500 побеждает пользователя с рейтингом 1600 — он
            получает около 20,5 очка и поднимается до 1520,5. Если бы он проиграл, он потерял бы
            всего около 11,5 очка — поражение от более сильного соперника стоит дешевле.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Glicko-2 — мастерство с учётом неопределённости</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            Glicko-2 отслеживает не только оценку мастерства (μ), но и степень неопределённости
            системы в этой оценке (σ). Таблица лидеров ранжирует по μ − 3σ — консервативному
            порогу, а не по сырой оценке, — чтобы одна удачная догадка не могла обогнать опытного,
            стабильного прогнозиста. Каждый пользователь начинает с μ=1500, σ=350.
          </p>
          <p>
            Например: новый пользователь, сделавший один верный и уверенный прогноз (Brier Score
            0,04), достигает μ≈1649, σ≈290 — то есть рейтинг μ−3σ ≈ 778, всё ещё{' '}
            <strong>ниже</strong> стартовой точки (1500). Только по мере накопления новых верных
            прогнозов и уменьшения σ настоящий рейтинг начнёт расти. В этом и заключается гарантия
            Glicko-2: объём и стабильность побеждают единичную удачную догадку, какой бы успешной
            она ни была.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Дополнительные системы подсчёта очков</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            Помимо трёх основных систем, Daatan также отслеживает: рейтинг репутации (RS) —
            исходный балл, основанный на верных прогнозах, взвешенных по степени уверенности;
            точность (Accuracy) — процент сбывшихся прогнозов; количество верных прогнозов;
            общее число вложенных единиц уверенности (CU); Peer Score и «AI Score» — насколько
            пользователь точнее сообщества или ИИ; TruthScore — стабильность способности
            превосходить сообщество; ROI — среднее изменение рейтинга репутации за прогноз; и
            взвешенный по времени Peer Score, вдохновлённый Metaculus, который придаёт больший вес
            более свежим прогнозам.
          </p>
          <p>
            Все эти системы, кроме глобального рейтинга репутации, можно отфильтровать по теме в
            <Link href="/leaderboard" className="text-blue-400 hover:text-blue-300 underline">
              {' '}таблице лидеров
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  )
}

function EoMethodologyPage() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6 lg:mb-8">
        <Calculator className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500" />
        <h1 className="text-2xl sm:text-3xl font-bold text-white">La poentado-metodo de Daatan</h1>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Mallonge</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            Daatan rangigas prognozistojn laŭ dek unu malsamaj poentaj sistemoj, ĉiu kontrolanta
            alian aspekton de prognoza kapablo: kruda precizeco, kalibrado (Brier-Poentaro),
            forto kompare al kontraŭulo (ELO), kaj necerteco-adaptita grado de certeco (Glicko-2).
            Ĉiu metodo, krom la origina &quot;Reputacia Poentaro&quot;, estas filtrebla laŭ unu
            temo en la estrolisto.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Brier-Poentaro — kalibrado</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            Mezuras kiom bone la grado de certeco, kiun uzanto deklaris, kongruas kun tio, kio
            efektive okazis: la kvadrata distanco inter la probablo, kiun la uzanto donis, kaj la
            efektiva rezulto. Ju pli malalta la poentaro, des pli bone; perfekta prognozo ricevas
            poentaron 0.
          </p>
          <p className="font-mono text-amber-300 bg-navy-800 rounded-lg p-3 text-sm">
            brierScore = (probablo − rezulto)²
          </p>
          <p>
            Ekzemple: uzanto, kiu taksis 75-procentan probablon ke prognozo realiĝos, kaj tio
            efektive okazis — ricevas poentaron (0,75−1)² = 0,0625. Se tio ne okazus, la poentaro
            estus (0,75−0)² = 0,5625 — naŭoble pli malbona, ĉar alta certeco kaj eraro estas
            punataj kvadrate.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">ELO-rangigo — forto kompare al kontraŭulo</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            Kiam du uzantoj engaĝiĝas al la sama prognozo, tiu, kiu estas pli proksima al la vero
            (pli malalta Brier-Poentaro), prenas ELO-poentojn de la alia — la sama metodo uzata en
            ŝako. Ju pli alta la rangigo, des pli bone.
          </p>
          <p>
            Ekzemple: uzanto kun rangigo 1500 venkas uzanton kun rangigo 1600 — la venkinto
            gajnas ĉirkaŭ 20,5 poentojn kaj altiĝas al 1520,5. Se anstataŭe tiu malvenkus, tiu
            perdus nur ĉirkaŭ 11,5 poentojn — malvenko kontraŭ pli forta kontraŭulo kostas malpli.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Glicko-2 — kapablo adaptita al necerteco</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            Glicko-2 spuras ne nur la takson de kapablo (μ), sed ankaŭ la gradon de necerteco de
            la sistemo pri ĝi (σ). La estrolisto rangigas laŭ μ − 3σ — konservativa sojlo, ne la
            kruda takso — por ke unu bonŝanca diveno ne povu superi spertan, konsekvencan
            prognoziston. Ĉiu uzanto komencas ĉe μ=1500, σ=350.
          </p>
          <p>
            Ekzemple: nova uzanto, kiu faras unu ĝustan kaj certan prognozon (Brier-Poentaro
            0,04), atingas μ≈1649, σ≈290 — do rangigon de μ−3σ ≈ 778, ankoraŭ{' '}
            <strong>sub</strong> la komenca punkto (1500). Nur kiam pliaj ĝustaj prognozoj
            akumuliĝos kaj σ malkreskos, la vera rangigo komencos altiĝi. Tio estas ĝuste la
            garantio de Glicko-2: kvanto kaj konsekvenco venkas unuopan bonŝancan divenon, kiel
            ajn sukcesan.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Pliaj poentaj sistemoj</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            Krom la tri ĉefaj sistemoj, Daatan ankaŭ spuras: Reputacian Poentaron (RS) — la
            origina poentaro, laŭ ĝustaj prognozoj pesitaj per grado de certeco; Precizecon
            (Accuracy) — la procento de prognozoj kiuj realiĝis; nombron da ĝustaj prognozoj;
            sumon de Certeco-Unuoj (CU) investitaj; Kunulan Poentaron (Peer Score) kaj
            &quot;AI-Poentaron&quot; — kiom pli preciza la uzanto estas ol la komunumo aŭ ol la
            AI; TruthScore — konsekvenco de la kapablo venki la komunumon; ROI — meza ŝanĝo en
            Reputacia Poentaro po prognozo; kaj tempo-pesitan Kunulan Poentaron, inspiritan de
            Metaculus, kiu donas pli altan pezon al pli freŝaj prognozoj.
          </p>
          <p>
            Ĉiuj ĉi tiuj sistemoj, krom la tutmonda Reputacia Poentaro, estas filtreblaj laŭ temo
            en la
            <Link href="/leaderboard" className="text-blue-400 hover:text-blue-300 underline">
              {' '}estrolisto
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  )
}

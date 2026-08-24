import type { Metadata } from 'next'
import { Info } from 'lucide-react'
import { getAppUrl } from '@/lib/branding'

const TITLES: Record<string, string> = {
  he: 'על דעתן',
  ru: 'О Daatan',
  eo: 'Pri Daatan',
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const appUrl = getAppUrl()
  return {
    title: TITLES[locale] ?? TITLES.he,
    alternates: {
      canonical: `${appUrl}/${locale}/about`,
      languages: {
        'x-default': `${appUrl}/about`,
        en: `${appUrl}/about`,
        he: `${appUrl}/he/about`,
        ru: `${appUrl}/ru/about`,
      },
    },
  }
}

export default async function LocaleAboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params

  if (locale === 'ru') return <RuAboutPage />
  if (locale === 'eo') return <EoAboutPage />
  return <HeAboutPage />
}

function HeAboutPage() {
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

function RuAboutPage() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6 lg:mb-8">
        <Info className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500" />
        <h1 className="text-2xl sm:text-3xl font-bold text-white">О Daatan</h1>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Что такое Daatan?</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>Daatan — это место, где мнения о будущем становятся прогнозами, которые можно проверить.</p>
          <p>
            Вместо того чтобы просто сказать «мне кажется, что-то произойдёт», на Daatan вы
            формулируете чёткое утверждение о будущем. Система помогает превратить его в
            измеримый прогноз: с ясной формулировкой, датой разрешения, вариантами исхода и
            понятными правилами оценки. Пользователю не нужно самому выстраивать всю структуру —
            достаточно ясно сказать, что, по его мнению, вероятно произойдёт. Дальше Daatan
            превращает это в нечто, что можно проверять со временем.
          </p>
          <p>
            Когда наступает срок, прогноз проверяется и разрешается. Так, прогноз за прогнозом,
            складывается послужной список, показывающий, кто умел верно читать реальность, в
            каких областях и с какой степенью уверенности.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Что здесь делают?</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            На Daatan можно создавать собственные прогнозы, участвовать в чужих прогнозах и
            смотреть, что сообщество думает об открытых вопросах.
          </p>
          <p>
            Каждый прогноз — это приглашение занять позицию: произойдёт это или нет, и с какой
            степенью уверенности. Можно следить за открытыми прогнозами, видеть, где есть
            согласие, а где — разногласия, и узнавать, кто точен на протяжении времени.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Как работает прогноз?</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            Каждый прогноз на Daatan строится из трёх простых вещей: что ожидается, к какому
            сроку это должно произойти, и с какой степенью уверенности пользователи оценивают,
            что это случится.
          </p>
          <p className="font-medium text-white">Например:</p>
          <p>«До 31 декабря 2026 года OpenAI выпустит новую модель под названием GPT-6».</p>
          <p>
            В таком случае ясно, что именно проверяется: была ли модель выпущена к установленной
            дате. Каждый пользователь может выбрать, считает ли он, что это произойдёт или нет, и
            добавить свою степень уверенности.
          </p>
          <p>
            Когда наступает срок, прогноз разрешается, и результат попадает в послужной список
            всех, кто в нём участвовал.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Что строится со временем?</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            Личный послужной список на Daatan складывается из прогнозов, в которых пользователь
            участвовал и которые были разрешены. Каждый раз, когда пользователь выбирает,
            произойдёт прогноз или нет, добавляет степень уверенности, и прогноз разрешается, —
            результат попадает в его послужной список.
          </p>
          <p>
            Список строится не как одно общее число. Он также складывается по темам. Поэтому у
            пользователя может быть сильный послужной список в мировой политике, более слабый — в
            израильском баскетболе, и совсем другой — в технологиях или экономике.
          </p>
          <p>
            Со временем Daatan позволяет увидеть не только, кто оказался прав, а где именно его
            суждения сильнее, и где его уверенность была слишком высокой или слишком низкой.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Кому это подходит?</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            Daatan подходит людям, которые любят думать наперёд: о политике, экономике,
            технологиях, спорте, культуре, обществе, новостях и любой области, где есть открытые
            вопросы о будущем.
          </p>
          <p>
            Он подходит тем, кто хочет проверять собственные суждения со временем, а также тем,
            кто хочет понимать, кому можно доверять больше в той или иной области — не по тому,
            кто звучит увереннее всех или лучше формулирует, а по тому, кто выстроил послужной
            список прогнозов, которые были действительно проверены и разрешены.
          </p>
          <p>На Daatan мнение о будущем не остаётся просто высказыванием. Оно становится частью послужного списка.</p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Кто стоит за Daatan?</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            Daatan создали <span className="text-white font-medium">Андрей Бар и Марик Кан</span>
            {' '}— два израильских предпринимателя, интересующихся технологиями, общественным
            дискурсом, прогнозированием и принятием решений, из желания создать место, где
            прогнозы, мнения и утверждения о будущем не исчезают через несколько дней, а
            проверяются со временем.
          </p>
          <p>
            Наша цель — создать доступный, интересный и серьёзный инструмент, в котором люди
            могут выстраивать послужной список суждений в разных областях, а также видеть
            послужные списки других: кто был точен в прошлом, в каких областях, и кому можно
            доверять больше, пытаясь понять, что вероятно произойдёт.
          </p>
        </div>
      </div>
    </div>
  )
}

function EoAboutPage() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6 lg:mb-8">
        <Info className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500" />
        <h1 className="text-2xl sm:text-3xl font-bold text-white">Pri Daatan</h1>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Kio estas Daatan?</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>Daatan estas loko kie opinioj pri la estonteco fariĝas kontroleblaj prognozoj.</p>
          <p>
            Anstataŭ simple diri &quot;mi pensas ke io okazos&quot;, en Daatan oni skribas klaran
            aserton pri la estonteco. La sistemo helpas transformi ĝin en mezureblan prognozon:
            kun ordigita formulo, decida dato, eblaj rezultoj kaj klaraj decidreguloj. Oni ne
            devas mem konstrui la tutan strukturon, sed nur klare diri, kio laŭ onia opinio
            okazos. De tie, Daatan igas tion io kontrolebla dum la tempo.
          </p>
          <p>
            Kiam la templimo alvenas, la prognozo estas kontrolata kaj decidata. Tiel, prognozo
            post prognozo, konstruiĝas rikordo montranta, kiu sciis legi la realecon, en kiuj
            kampoj, kaj kun kia grado de certeco.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Kion oni faras ĉi tie?</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            En Daatan oni povas krei proprajn prognozojn, partopreni en prognozoj de aliaj, kaj
            vidi, kion la komunumo opinias pri malfermaj demandoj.
          </p>
          <p>
            Ĉiu prognozo estas invito preni pozicion: ĉu tio okazos aŭ ne, kaj kun kia grado de
            certeco. Oni povas sekvi malfermajn prognozojn, vidi, kie estas interkonsento aŭ
            malkonsento, kaj malkovri, kiuj homoj estas precizaj dum la tempo.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Kiel funkcias prognozo?</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            Ĉiu prognozo en Daatan konsistas el tri simplaj eroj: kio atendeblas okazi, ĝis kiam
            tio devus okazi, kaj kun kia grado de certeco la uzantoj taksas, ke tio okazos.
          </p>
          <p className="font-medium text-white">Ekzemple:</p>
          <p>&quot;Ĝis la 31-a de decembro 2026, OpenAI lanĉos novan modelon nomatan GPT-6.&quot;</p>
          <p>
            En tia kazo klaras, kio estas kontrolata: ĉu la modelo estis lanĉita antaŭ la fiksita
            dato. Ĉiu uzanto povas elekti, ĉu laŭ ties opinio tio okazos aŭ ne, kaj aldoni sian
            gradon de certeco.
          </p>
          <p>
            Kiam la templimo alvenas, la prognozo estas decidata, kaj la rezulto eniras la
            rikordon de ĉiuj, kiuj partoprenis en ĝi.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Kio konstruiĝas dum la tempo?</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            La persona rikordo en Daatan konsistas el prognozoj, en kiuj la uzanto partoprenis
            kaj kiuj estis decidataj. Ĉiufoje, kiam uzanto elektas, ĉu prognozo okazos aŭ ne,
            aldonas gradon de certeco, kaj la prognozo estas decidata, la rezulto eniras ties
            rikordon.
          </p>
          <p>
            La rikordo ne konsistas nur el unu ĝenerala nombro. Ĝi ankaŭ konstruiĝas laŭ temoj.
            Tial uzanto povus havi fortan rikordon pri monda politiko, malpli fortan rikordon pri
            israela korbopilko, kaj tute alian rikordon pri teknologio aŭ ekonomio.
          </p>
          <p>
            Dum la tempo, Daatan ebligas vidi ne nur, kiu pravis, sed ankaŭ kie ties juĝkapablo
            estas plej forta, kaj kie ties certeco estis tro alta aŭ tro malalta.
          </p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Por kiu ĝi taŭgas?</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            Daatan taŭgas por homoj, kiuj ŝatas pensi antaŭen: pri politiko, ekonomio, teknologio,
            sporto, kulturo, socio, novaĵoj, kaj ĉiu kampo, kie ekzistas malfermaj demandoj pri la
            estonteco.
          </p>
          <p>
            Ĝi taŭgas por tiuj, kiuj volas testi sian propran juĝkapablon dum la tempo, kaj ankaŭ
            por tiuj, kiuj volas kompreni, kiun oni povas pli fidi en ĉiu kampo — ne laŭ kiu sonas
            plej certa aŭ plej bele esprimas sin, sed laŭ kiu konstruis rikordon de prognozoj,
            kiuj estis efektive kontrolitaj kaj decidataj.
          </p>
          <p>En Daatan, opinio pri la estonteco ne restas nur diro. Ĝi aliĝas al la rikordo.</p>
        </div>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Kiu staras malantaŭ Daatan?</h2>
        </div>
        <div className="p-6 space-y-3 text-text-secondary">
          <p>
            Daatan estis konstruita de{' '}
            <span className="text-white font-medium">Andrei Bar kaj Marik Kan</span>, du israelaj
            entreprenistoj, interesiĝantaj pri teknologio, publika diskurso, prognozado kaj
            decidado, el la deziro krei lokon, kie prognozoj, opinioj kaj asertoj pri la
            estonteco ne malaperas post kelkaj tagoj, sed estas kontrolataj dum la tempo.
          </p>
          <p>
            Nia celo estas konstrui alireblan, interesan kaj seriozan ilon, en kiu homoj povas
            evoluigi rikordon de juĝkapablo en diversaj kampoj, kaj ankaŭ vidi la rikordojn de
            aliaj: kiu pravis en la pasinteco, en kiuj kampoj, kaj kiun oni povas pli fidi, kiam
            oni provas kompreni, kio verŝajne okazos.
          </p>
        </div>
      </div>
    </div>
  )
}

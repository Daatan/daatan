import { getElectionMatrix } from '@/lib/services/elections'
import { ElectionMatrix } from './ElectionMatrix'

// Fully live off the app DB (forecasts tagged "Israeli Elections 2026" + their
// latest Oracul snapshot), so never statically cached.
export const dynamic = 'force-dynamic'

export default async function ElectionsPage() {
  const matrix = await getElectionMatrix()

  return (
    <main className="max-w-[1400px] mx-auto px-4 py-10 md:py-14">
      <header className="mb-8 md:mb-12">
        <span className="inline-block px-3 py-1 rounded-full bg-amber-400/15 text-amber-300 text-[10px] font-black tracking-[0.2em] mb-4">
          דעתן · בחירות 2026
        </span>
        <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-white">
          מי צדק בבחירות 2026
        </h1>
        <p className="mt-3 max-w-2xl text-slate-400 text-sm md:text-base leading-relaxed">
          כל תחזית המתויגת לבחירות 2026 בישראל, ועמדתו של כל פרשן שאנו עוקבים אחריו לגביה — היישר
          מעמדות המקורות של האורקל. ירוק נוטה לכן, אדום נוטה ללא, אפור מסויג; תא ריק פירושו שאין
          עדיין כיסוי.
        </p>
      </header>

      <ElectionMatrix matrix={matrix} />
    </main>
  )
}

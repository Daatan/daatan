import type { Metadata } from 'next'

// Predates the standalone Daatan/elections repo (daatan#1217) — that repo now
// owns elections.daatan.com entirely (its own nginx/cert/container; see
// infra/nginx/nginx-prod-ssl.conf), so this page only exists at daatan.com/elections
// now, unlinked from any nav and kept out of the index (`robots` below).
export const metadata: Metadata = {
  title: 'דעתן · בחירות 2026 — מי צדק?',
  description:
    'מעקב אחר מה שאמרו הפרשנים המובילים בישראל על בחירות 2026, אירוע אחר אירוע, בציון בדיעבד מול האופן שבו כל תחזית הוכרעה בפועל.',
  robots: { index: false, follow: false },
  alternates: { canonical: '/elections' },
  openGraph: { url: '/elections', type: 'website' },
}

// Hebrew-first, RTL. Full he/en/ru locale switching is a follow-up; the base
// language of this section is Hebrew.
export default function ElectionsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div dir="rtl" lang="he" className="min-h-screen bg-[#0b1020] text-slate-100">
      {children}
    </div>
  )
}

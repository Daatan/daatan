import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import OracleV2Playground from '@/app/admin/OracleV2Playground'

export const dynamic = 'force-dynamic'

// Same playground as /admin/oracle-v2, without the app chrome (Sidebar hides
// itself and MainContent drops its margin for this route — see Sidebar.tsx /
// MainContent.tsx). Still ADMIN-gated: it drives paid Oracul LLM calls.
export default async function OracleV2StandalonePage() {
  const session = await auth()
  if (!session?.user || session.user.role !== 'ADMIN') redirect('/')
  return (
    <div className="p-4">
      <OracleV2Playground />
    </div>
  )
}

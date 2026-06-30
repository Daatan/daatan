import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { isSelfHosted } from '@/lib/edition'
import BotsTable from '../BotsTable'

export const dynamic = 'force-dynamic'

export default async function AdminBotsPage() {
  // The bot system is a SaaS-only feature — not part of the self-hosted edition.
  if (isSelfHosted()) redirect('/admin/forecasts')

  const session = await auth()

  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/')
  }

  return <BotsTable />
}

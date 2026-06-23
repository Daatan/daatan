import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import SourcesTab from '../SourcesTab'

export const dynamic = 'force-dynamic'

export default async function AdminSourcesPage() {
  const session = await auth()

  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/')
  }

  return <SourcesTab />
}

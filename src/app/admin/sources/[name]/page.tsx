import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import OutletDetailPanel from './OutletDetailPanel'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ name: string }>
}

export default async function AdminOutletDetailPage({ params }: Props) {
  const session = await auth()

  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/')
  }

  const { name } = await params
  return <OutletDetailPanel name={decodeURIComponent(name)} />
}

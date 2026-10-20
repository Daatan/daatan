import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import InvitesTable from '../InvitesTable'


export default async function AdminInvitesPage() {
  const session = await auth()

  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/')
  }

  return <InvitesTable />
}

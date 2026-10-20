import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import UsersTable from '../UsersTable'


export default async function AdminUsersPage() {
  const session = await auth()

  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/')
  }

  return <UsersTable />
}

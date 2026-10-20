import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import OracleTab from '../OracleTab'


export default async function AdminOraclePage() {
  const session = await auth()

  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/')
  }

  return <OracleTab />
}

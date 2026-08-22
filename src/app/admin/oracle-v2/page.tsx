import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import OracleV2Playground from '../OracleV2Playground'

export const dynamic = 'force-dynamic'

export default async function AdminOracleV2Page() {
  const session = await auth()
  if (!session?.user || session.user.role !== 'ADMIN') redirect('/')
  return <OracleV2Playground />
}

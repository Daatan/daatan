import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import AuthorsTab from '../AuthorsTab'

export const dynamic = 'force-dynamic'

export default async function AdminAuthorsPage() {
  const session = await auth()

  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/')
  }

  return <AuthorsTab />
}

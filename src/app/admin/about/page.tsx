import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import AboutPanel from '../AboutPanel'

export const dynamic = 'force-dynamic'

export default async function AdminAboutPage() {
  const session = await auth()

  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/')
  }

  return <AboutPanel />
}

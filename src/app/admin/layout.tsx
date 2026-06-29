import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { env } from '@/env'
import AdminNav from './AdminNav'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user || (session.user.role !== 'ADMIN' && session.user.role !== 'RESOLVER' && session.user.role !== 'APPROVER')) {
    redirect('/')
  }

  const isAdmin = session.user.role === 'ADMIN'
  const selfHosted = env.DAATAN_EDITION === 'self_hosted'

  return (
    <div className="admin-container p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Admin Panel</h1>
      <AdminNav isAdmin={isAdmin} selfHosted={selfHosted} />
      {children}
    </div>
  )
}

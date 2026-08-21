import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import type { Metadata } from 'next'
import CreateForecastClient from './CreateForecastClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Create Forecast - DAATAN',
  robots: { index: false, follow: false },
}

export default async function CreatePage() {
  const session = await auth()

  if (!session?.user?.id) {
    redirect('/auth/signin?callbackUrl=/create')
  }

  return <CreateForecastClient userId={session.user.id} />
}

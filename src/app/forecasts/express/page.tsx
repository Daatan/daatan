import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { aiFeaturesEnabled } from '@/lib/capabilities'
import ExpressForecastClient from './ExpressForecastClient'

export default async function ExpressForecastPage() {
  // Express is an AI feature — off by default on self-host. Send operators to
  // the manual create flow instead of an unusable page.
  if (!aiFeaturesEnabled()) {
    redirect('/create')
  }

  const session = await auth()

  if (!session?.user?.id) {
    redirect('/auth/signin?callbackUrl=/forecasts/express')
  }

  return <ExpressForecastClient userId={session.user.id} />
}

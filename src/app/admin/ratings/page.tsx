import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import RatingFeedbackTab from '../RatingFeedbackTab'

export const dynamic = 'force-dynamic'

export default async function AdminRatingsPage() {
  const session = await auth()

  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/')
  }

  return <RatingFeedbackTab />
}

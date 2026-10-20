import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import ProfileEditForm from '@/components/profile/ProfileEditForm'


export default async function EditProfilePage() {
  const session = await auth()

  if (!session?.user?.id) {
    redirect('/auth/signin?callbackUrl=/profile/edit')
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      username: true,
      image: true,
      avatarUrl: true,
      website: true,
      twitterHandle: true,
      emailNotifications: true,
    }
  })

  if (!user) {
    redirect('/')
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-black text-white tracking-tight">Edit Profile</h1>
        <p className="text-gray-500 mt-2">Update your public profile information.</p>
      </div>
      <ProfileEditForm user={user} />
    </div>
  )
}

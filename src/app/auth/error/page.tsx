import { Suspense } from 'react'
import AuthErrorClient from './AuthErrorClient'

// Force dynamic rendering to ensure page is always server-rendered

function AuthErrorLoading() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-navy-800">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
  )
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={<AuthErrorLoading />}>
      <AuthErrorClient />
    </Suspense>
  )
}

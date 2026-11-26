'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { AlertCircle, ArrowLeft } from 'lucide-react'
import { useTranslations } from 'next-intl'

export default function AuthErrorClient() {
  const t = useTranslations('auth.error')
  const searchParams = useSearchParams()
  const error = searchParams.get('error')
  const callbackUrl = searchParams.get('callbackUrl') || '/'
  const signInHref = callbackUrl && callbackUrl !== '/' ? `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}` : '/auth/signin'

  return (
    <div className="min-h-screen bg-navy-800 flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-navy-700 rounded-2xl shadow-xs border border-navy-600 p-8 text-center space-y-6">
        <div className="flex justify-center">
          <div className="p-3 bg-red-900/20 rounded-full">
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-white">{t('title')}</h1>
          <p className="text-gray-500">
            {error === 'Configuration' ? t('configuration') :
             error === 'AccessDenied' ? t('accessDenied') :
             error === 'Verification' ? t('verification') :
             error === 'OAuthSignin' ? (
               <>
                 Google sign-in failed. Add this to your Google OAuth client&apos;s Authorized redirect URIs in Google Cloud Console:{' '}
                 <code className="block mt-2 p-2 bg-navy-700 rounded-sm text-sm break-all">
                   {typeof window !== 'undefined' ? `${window.location.origin}/api/auth/callback/google` : 'https://your-domain.com/api/auth/callback/google'}
                 </code>
                 {' '}Also verify GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set on the server.
               </>
             ) :
             error === 'OAuthCallback' ? t('oauthCallback') :
             (error || t('unexpected'))}
          </p>
        </div>

        <div className="pt-4">
          <Link
            href={signInHref}
            className="inline-flex items-center gap-2 text-blue-600 font-medium hover:text-cobalt-light transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('backToSignIn')}
          </Link>
        </div>

        <div className="pt-8 border-t border-navy-600">
          <Link href="/" className="flex items-center justify-center gap-2 grayscale hover:grayscale-0 transition-all opacity-50 hover:opacity-100">
            <Image src="/logo-icon.svg" alt="DAATAN" width={24} height={24} />
            <span className="text-sm font-bold text-white">DAATAN</span>
          </Link>
        </div>
      </div>
    </div>
  )
}

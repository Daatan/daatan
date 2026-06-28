'use client'

import { signIn, useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BrandLogo } from '@/components/BrandLogo'
import { LogIn, Loader2, AlertCircle, Mail, Lock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { analytics } from '@/lib/analytics'
import { useTranslations } from 'next-intl'

export default function SignInClient() {
  const t = useTranslations('auth.signin')
  const sessionData = useSession()
  const status = sessionData?.status || 'unauthenticated'
  
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/'
  const error = searchParams.get('error')

  const [formData, setFormData] = useState({
    email: '',
    password: '',
  })
  const [isLoading, setIsLoading] = useState(false)
  const [credentialsError, setCredentialsError] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'authenticated') {
      router.push(callbackUrl)
    }
  }, [status, router, callbackUrl])

  const handleGoogleSignIn = async () => {
    analytics.signIn({ method: 'google' })
    await signIn('google', { callbackUrl })
  }

  const handleCredentialsSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setCredentialsError(null)

    try {
      const result = await signIn('credentials', {
        email: formData.email,
        password: formData.password,
        redirect: false,
        callbackUrl,
      })

      if (result?.error) {
        setCredentialsError(t('invalidCredentials'))
      } else {
        analytics.signIn({ method: 'credentials' })
        router.push(callbackUrl)
        router.refresh()
      }
    } catch (err) {
      setCredentialsError(t('unexpectedError'))
    } finally {
      setIsLoading(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-navy-800">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-navy-800 flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-navy-700 rounded-2xl shadow-sm border border-navy-600 p-8 space-y-8">
        <div className="flex flex-col items-center text-center">
          <Link href="/">
            <BrandLogo fallbackSrc="/logo-icon.svg" width={64} height={64} className="mb-4" />
          </Link>
          <h1 className="text-2xl font-bold text-white">{t('title')}</h1>
          <p className="text-gray-500 mt-2">{t('description')}</p>
        </div>

        {(error || credentialsError) && (
          <div className="bg-red-900/20 border border-red-800/40 text-red-400 px-4 py-3 rounded-lg text-sm flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p>{credentialsError || t('error')}</p>
              {error === 'OAuthSignin' && (
                <p className="text-xs mt-1 text-red-500/80">{t('googleFailed')}</p>
              )}
              {error === 'CredentialsSignin' && (
                <p className="text-xs mt-1 text-red-500/80">{t('invalidCreds')}</p>
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleCredentialsSignIn} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5" htmlFor="email">
              {t('emailLabel')}
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                id="email"
                type="email"
                required
                disabled={isLoading}
                className="w-full pl-10 pr-4 py-2.5 bg-navy-800 border border-navy-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all disabled:opacity-50"
                placeholder={t('emailPlaceholder')}
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-text-secondary" htmlFor="password">
                {t('passwordLabel')}
              </label>
              <Link href="/auth/forgot-password" className="text-xs text-blue-500 hover:text-blue-400 transition-colors">
                {t('forgotPassword')}
              </Link>
            </div>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                id="password"
                type="password"
                required
                disabled={isLoading}
                className="w-full pl-10 pr-4 py-2.5 bg-navy-800 border border-navy-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all disabled:opacity-50"
                placeholder={t('passwordPlaceholder')}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              />
            </div>
          </div>

          <Button
            type="submit"
            className="w-full py-3"
            disabled={isLoading}
            leftIcon={isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5" />}
          >
            {isLoading ? t('submitting') : t('submit')}
          </Button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-navy-600"></div>
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-navy-700 px-2 text-gray-500 tracking-wider font-medium">{t('orContinueWith')}</span>
          </div>
        </div>

        <Button
          variant="outline"
          className="w-full py-3 border-navy-600 hover:bg-navy-800 text-text-secondary"
          onClick={handleGoogleSignIn}
          leftIcon={
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
          }
        >
          Google
        </Button>

        <div className="pt-2 text-center text-sm">
          <p className="text-gray-500">
            {t('noAccount')}{' '}
            <Link href="/auth/signup" className="text-blue-500 hover:text-blue-400 font-medium transition-colors">
              {t('signUp')}
            </Link>
          </p>
        </div>
      </div>
      
      <div className="mt-8 flex items-center gap-2 text-gray-500">
        <LogIn className="w-4 h-4" />
        <span className="text-sm">{t('secure')}</span>
      </div>
    </div>
  )
}

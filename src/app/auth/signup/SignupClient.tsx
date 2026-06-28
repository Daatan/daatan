'use client'

import { useState } from 'react'
import { toError } from '@/lib/utils/error'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { UserPlus, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useTranslations } from 'next-intl'

export default function SignupClient() {
  const t = useTranslations('auth.signup')
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/'
  const invite = searchParams.get('invite') || undefined

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, invite }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to sign up')
      }

      // Automatically sign in after successful signup
      const result = await signIn('credentials', {
        email: formData.email,
        password: formData.password,
        redirect: false,
        callbackUrl,
      })

      if (result?.error) {
        router.push('/auth/signin?error=CredentialsSignin')
      } else {
        router.push(callbackUrl)
        router.refresh()
      }
    } catch (err) {
      setError(toError(err).message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-navy-800 flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-navy-700 rounded-2xl shadow-sm border border-navy-600 p-8 space-y-8">
        <div className="flex flex-col items-center text-center">
          <Link href="/">
            <Image src="/logo-icon.svg" alt="DAATAN" width={64} height={64} className="mb-4" />
          </Link>
          <h1 className="text-2xl font-bold text-white">{t('title')}</h1>
          <p className="text-gray-500 mt-2">{t('description')}</p>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-800/40 text-red-400 px-4 py-3 rounded-lg text-sm flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5" htmlFor="name">
              {t('nameLabel')}
            </label>
            <input
              id="name"
              type="text"
              required
              disabled={isLoading}
              className="w-full px-4 py-2.5 bg-navy-800 border border-navy-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all disabled:opacity-50"
              placeholder={t('namePlaceholder')}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5" htmlFor="email">
              {t('emailLabel')}
            </label>
            <input
              id="email"
              type="email"
              required
              disabled={isLoading}
              className="w-full px-4 py-2.5 bg-navy-800 border border-navy-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all disabled:opacity-50"
              placeholder={t('emailPlaceholder')}
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5" htmlFor="password">
              {t('passwordLabel')}
            </label>
            <input
              id="password"
              type="password"
              required
              disabled={isLoading}
              className="w-full px-4 py-2.5 bg-navy-800 border border-navy-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all disabled:opacity-50"
              placeholder={t('passwordPlaceholder')}
              minLength={8}
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            />
            <p className="mt-1.5 text-[11px] text-gray-500">{t('passwordHint')}</p>
          </div>

          <Button
            type="submit"
            className="w-full py-3"
            disabled={isLoading}
            leftIcon={isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <UserPlus className="w-5 h-5" />}
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
          className="w-full py-3 border-navy-600 hover:bg-navy-800"
          onClick={() => signIn('google', { callbackUrl })}
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
          {t('google')}
        </Button>

        <div className="pt-2 text-center text-sm">
          <p className="text-gray-500">
            {t('alreadyHaveAccount')}{' '}
            <Link href="/auth/signin" className="text-blue-500 hover:text-blue-400 font-medium transition-colors">
              {t('signIn')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

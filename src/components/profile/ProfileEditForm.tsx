'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { User, Globe, Bell, Save, X, Upload } from 'lucide-react'
import { Twitter } from '@/components/icons/BrandIcons'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/ui/Button'
import { toast } from 'react-hot-toast'

interface ProfileEditFormProps {
  user: {
    name: string | null
    image: string | null
    avatarUrl?: string | null
    username: string | null
    website: string | null
    twitterHandle: string | null
    emailNotifications: boolean
  }
}

export default function ProfileEditForm({ user }: ProfileEditFormProps) {
  const t = useTranslations('profile')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [formData, setFormData] = useState({
    name: user.name || '',
    username: user.username || '',
    website: user.website || '',
    twitterHandle: user.twitterHandle || '',
    emailNotifications: user.emailNotifications,
    avatarUrl: user.avatarUrl || user.image || '',
  })

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('fileTooLarge'))
      return
    }

    if (!file.type.startsWith('image/')) {
      toast.error(t('fileMustBeImage'))
      return
    }

    setUploadingAvatar(true)
    const uploadData = new FormData()
    uploadData.append('avatar', file)

    try {
      const response = await fetch('/api/profile/avatar', {
        method: 'POST',
        body: uploadData,
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || t('avatarError'))
      }

      setFormData(prev => ({ ...prev, avatarUrl: result.avatarUrl }))
      toast.success(t('avatarSuccess'))
      router.refresh() // Tell Next.js to re-fetch data for the current page
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('avatarError'))
    } finally {
      setUploadingAvatar(false)
      // Reset input so the same file can be selected again if needed
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess(false)

    try {
      // The update endpoint ignores avatarUrl because it's handled by its own endpoint
      const updateData: Partial<typeof formData> = { ...formData }
      delete updateData.avatarUrl

      const response = await fetch('/api/profile/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || t('saveError'))
      }

      setSuccess(true)
      setTimeout(() => {
        router.push('/profile')
        router.refresh()
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-navy-700 border border-navy-600 rounded-3xl p-6 sm:p-8 shadow-sm">
      <div className="space-y-6">
        {/* Avatar Upload */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pb-6 border-b border-navy-600">
          <Avatar 
            src={formData.avatarUrl} 
            name={user.name || user.username} 
            size={80} 
            className="ring-4 ring-white shadow-sm"
          />
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-white">{t('profilePicture')}</h3>
            <p className="text-xs text-gray-500 max-w-sm">
              {t('uploadDescription')}
            </p>
            <div className="flex gap-2">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                ref={fileInputRef}
                onChange={handleAvatarUpload}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                loading={uploadingAvatar}
                leftIcon={!uploadingAvatar && <Upload className="w-4 h-4" />}
              >
                {t('changePicture')}
              </Button>
            </div>
          </div>
        </div>

        {/* Display Name */}
        <div>
          <label htmlFor="name" className="flex items-center gap-2 text-sm font-bold text-text-secondary mb-2">
            <User className="w-4 h-4 text-gray-400" />
            {t('displayNameLabel')}
          </label>
          <input
            type="text"
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder={t('displayNamePlaceholder')}
            className="w-full px-4 py-3 bg-navy-800 text-white placeholder:text-text-subtle border border-navy-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-cobalt focus:border-transparent"
            maxLength={60}
          />
          <p className="text-xs text-gray-500 mt-1">{t('displayNameHelper')}</p>
        </div>

        {/* Username */}
        <div>
          <label htmlFor="username" className="flex items-center gap-2 text-sm font-bold text-text-secondary mb-2">
            <User className="w-4 h-4 text-gray-400" />
            {t('usernameLabel')}
          </label>
          <input
            type="text"
            id="username"
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            placeholder={t('usernamePlaceholder')}
            className="w-full px-4 py-3 bg-navy-800 text-white placeholder:text-text-subtle border border-navy-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-cobalt focus:border-transparent"
            maxLength={30}
          />
          <p className="text-xs text-gray-500 mt-1">{t('usernameHelper')}</p>
        </div>

        {/* Website */}
        <div>
          <label htmlFor="website" className="flex items-center gap-2 text-sm font-bold text-text-secondary mb-2">
            <Globe className="w-4 h-4 text-gray-400" />
            {t('websiteLabel')}
          </label>
          <input
            type="url"
            id="website"
            value={formData.website}
            onChange={(e) => setFormData({ ...formData, website: e.target.value })}
            placeholder={t('websitePlaceholder')}
            className="w-full px-4 py-3 bg-navy-800 text-white placeholder:text-text-subtle border border-navy-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-cobalt focus:border-transparent"
          />
          <p className="text-xs text-gray-500 mt-1">{t('websiteHelper')}</p>
        </div>

        {/* Twitter Handle */}
        <div>
          <label htmlFor="twitterHandle" className="flex items-center gap-2 text-sm font-bold text-text-secondary mb-2">
            <Twitter className="w-4 h-4 text-gray-400" />
            {t('twitterLabel')}
          </label>
          <div className="flex items-center">
            <span className="px-4 py-3 bg-navy-800 border border-r-0 border-navy-600 rounded-l-xl text-gray-500 font-medium">@</span>
            <input
              type="text"
              id="twitterHandle"
              value={formData.twitterHandle}
              onChange={(e) => setFormData({ ...formData, twitterHandle: e.target.value.replace('@', '') })}
              placeholder={t('twitterPlaceholder')}
              className="flex-1 px-4 py-3 border border-navy-600 rounded-r-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              maxLength={15}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">{t('twitterHelper')}</p>
        </div>

        {/* Email Notifications */}
        <div className="border-t border-navy-600 pt-6">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.emailNotifications}
              onChange={(e) => setFormData({ ...formData, emailNotifications: e.target.checked })}
              className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-bold text-text-secondary">{t('emailNotifications')}</span>
            </div>
          </label>
          <p className="text-xs text-gray-500 mt-2 ml-8">{t('emailNotificationsHelper')}</p>
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div className="bg-red-900/20 border border-red-800/50 text-red-400 px-4 py-3 rounded-xl text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-teal/10 border border-green-200 text-teal px-4 py-3 rounded-xl text-sm">
            {t('savedSuccess')}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 pt-4">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-4 h-4" />
            {loading ? t('saving') : t('saveChanges')}
          </button>
          <Link
            href="/profile"
            className="flex items-center justify-center gap-2 bg-navy-700 text-text-secondary px-6 py-3 rounded-xl font-bold hover:bg-navy-600 transition-colors"
          >
            <X className="w-4 h-4" />
            {tCommon('cancel')}
          </Link>
        </div>
      </div>
    </form>
  )
}

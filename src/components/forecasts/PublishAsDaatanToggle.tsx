'use client'

import { useTranslations } from 'next-intl'

/** Admin-only create option (#2301): publish under the Daatan account. Off by default. */
export function PublishAsDaatanToggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const t = useTranslations('forecast')
  return (
    <div className="px-4 py-3 rounded-xl border border-navy-600 text-sm">
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-cobalt"
        />
        <span className="font-medium text-white">{t('publishAsDaatan')}</span>
      </label>
      <p className="text-xs text-gray-500 mt-1 ml-7">{t('publishAsDaatanHint')}</p>
    </div>
  )
}

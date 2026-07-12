'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Calendar } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { formatDdmmyyyy, parseDdmmyyyy, parseTime24 } from '@/lib/utils/date'

/**
 * Date + time entry with an explicit, locale-independent format: a DD/MM/YYYY
 * text field, a 24-hour HH:MM field, and a calendar button that opens the
 * native date picker. Replaces <input type="datetime-local">, whose sub-field
 * editing is fiddly (worse in RTL) and whose display order follows the browser
 * locale (month-first for en-US) rather than the site's convention.
 *
 * `value`/`onChange` keep the local "YYYY-MM-DDTHH:MM" contract of
 * datetime-local, so parents are unchanged. While the fields are incomplete or
 * unparseable, onChange('') is emitted.
 */

const FIELD_CLASSES =
  'py-3 border rounded-xl text-sm bg-navy-800 text-white placeholder:text-text-subtle ' +
  'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'

interface DateTimeFieldProps {
  /** id of the date input, for an external <label htmlFor>. */
  id?: string
  /** Local "YYYY-MM-DDTHH:MM" (the datetime-local format) or ''. */
  value: string
  /** Called with the same format, or '' while incomplete/invalid. */
  onChange: (value: string) => void
  /**
   * "HH:MM" a blank time field counts as (e.g. '23:59' where only the date
   * matters). Without it a blank time makes the value incomplete.
   */
  defaultTime?: string
  /** Earliest date ("YYYY-MM-DD") selectable in the calendar picker. */
  min?: string
  /** Extra invalid state decided by the parent (e.g. date in the past). */
  invalid?: boolean
}

function splitValue(value: string): { date: string; time: string } {
  const m = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  if (!m) return { date: '', time: '' }
  return { date: formatDdmmyyyy(m[1]), time: m[2] }
}

export function DateTimeField({ id, value, onChange, defaultTime, min, invalid }: DateTimeFieldProps) {
  const t = useTranslations('dateTimeField')
  const [dateText, setDateText] = useState(() => splitValue(value).date)
  const [timeText, setTimeText] = useState(() => splitValue(value).time)
  const [dateBlurred, setDateBlurred] = useState(false)
  const [timeBlurred, setTimeBlurred] = useState(false)
  // Last value we emitted (or received): lets us resync the text fields when
  // the parent changes value externally without clobbering in-progress typing.
  const lastValue = useRef(value)
  const pickerRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (value !== lastValue.current) {
      lastValue.current = value
      const next = splitValue(value)
      setDateText(next.date)
      setTimeText(next.time)
    }
  }, [value])

  const emit = (nextDateText: string, nextTimeText: string) => {
    const ymd = parseDdmmyyyy(nextDateText)
    const time = nextTimeText.trim() === '' ? (defaultTime ?? null) : parseTime24(nextTimeText)
    const next = ymd && time ? `${ymd}T${time}` : ''
    if (next !== lastValue.current) {
      lastValue.current = next
      onChange(next)
    }
  }

  const handleDateChange = (text: string) => {
    setDateText(text)
    emit(text, timeText)
  }

  const handleTimeChange = (text: string) => {
    setTimeText(text)
    emit(dateText, text)
  }

  const openPicker = () => {
    const el = pickerRef.current
    if (!el) return
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker()
      } catch {
        el.focus()
      }
    } else {
      el.focus()
    }
  }

  const parsedDate = parseDdmmyyyy(dateText)
  const dateInvalid = dateBlurred && dateText !== '' && !parsedDate
  const timeInvalid = timeBlurred && timeText !== '' && !parseTime24(timeText)
  const borderFor = (bad: boolean) => (bad ? 'border-red-500' : 'border-navy-600')

  return (
    <div>
      {/* Forced LTR so DD/MM/YYYY and HH:MM read correctly inside RTL layouts. */}
      <div dir="ltr" className="flex items-stretch gap-2">
        <input
          type="text"
          inputMode="numeric"
          id={id}
          value={dateText}
          onChange={(e) => handleDateChange(e.target.value)}
          onBlur={() => setDateBlurred(true)}
          placeholder={t('datePlaceholder')}
          aria-label={t('dateAriaLabel')}
          className={`flex-1 min-w-0 px-4 ${FIELD_CLASSES} ${borderFor(dateInvalid || !!invalid)}`}
        />
        <input
          type="text"
          inputMode="numeric"
          value={timeText}
          onChange={(e) => handleTimeChange(e.target.value)}
          onBlur={() => setTimeBlurred(true)}
          placeholder={t('timePlaceholder')}
          aria-label={t('timeAriaLabel')}
          className={`w-20 px-2 text-center ${FIELD_CLASSES} ${borderFor(timeInvalid || !!invalid)}`}
        />
        <div className="relative">
          <button
            type="button"
            onClick={openPicker}
            aria-label={t('openCalendar')}
            title={t('openCalendar')}
            className="h-full px-3 border border-navy-600 rounded-xl bg-navy-800 text-gray-400 hover:text-blue-500 hover:border-blue-500 transition-colors"
          >
            <Calendar className="w-4 h-4" />
          </button>
          {/* Kept in the layout (not display:none) so showPicker() anchors the
              native calendar next to the button. */}
          <input
            ref={pickerRef}
            type="date"
            tabIndex={-1}
            aria-hidden="true"
            min={min}
            value={parsedDate ?? ''}
            onChange={(e) => handleDateChange(formatDdmmyyyy(e.target.value))}
            className="absolute bottom-0 left-0 w-px h-px opacity-0"
          />
        </div>
      </div>
      <p className="text-xs text-text-subtle mt-1">{t('hint')}</p>
    </div>
  )
}

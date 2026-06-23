'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Send } from 'lucide-react'
import type { Comment } from './CommentThread'
import { createClientLogger } from '@/lib/client-logger'
import { toast } from 'react-hot-toast'
import { analytics } from '@/lib/analytics'
import { Button } from '@/components/ui/Button'

const log = createClientLogger('CommentForm')

interface CommentFormProps {
  predictionId?: string
  parentId?: string
  onCommentAdded: (comment: Comment) => void
  onCancel?: () => void
  placeholder?: string
}

export default function CommentForm({
  predictionId,
  parentId,
  onCommentAdded,
  onCancel,
  placeholder,
}: CommentFormProps) {
  const t = useTranslations('comments')
  const [text, setText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!text.trim() || isSubmitting) return

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text.trim(),
          predictionId,
          parentId,
        }),
      })

      if (response.ok) {
        const comment = await response.json()
        analytics.commentPosted({ is_reply: !!parentId })
        onCommentAdded(comment)
        setText('')
        onCancel?.()
      } else {
        const error = await response.json()
        toast.error(error.error || t('postFailed'))
      }
    } catch (error) {
      log.error({ err: error }, 'Error posting comment')
      toast.error(t('postFailed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? t('shareThoughts')}
        rows={parentId ? 2 : 3}
        maxLength={2000}
        className="w-full px-4 py-3 bg-navy-800 text-white placeholder:text-text-subtle border border-navy-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-cobalt resize-none"
        disabled={isSubmitting}
      />
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">
          {text.length}/2000
        </span>
        <div className="flex gap-2">
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              {t('cancel')}
            </Button>
          )}
          <Button
            type="submit"
            loading={isSubmitting}
            disabled={!text.trim()}
            leftIcon={<Send className="w-4 h-4" />}
          >
            {t('post')}
          </Button>
        </div>
      </div>
    </form>
  )
}

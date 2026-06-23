'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { MessageSquare, Loader2 } from 'lucide-react'
import CommentItem from './CommentItem'
import CommentForm from './CommentForm'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('CommentThread')

export interface Comment {
  id: string
  text: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  author: {
    id: string
    name: string | null
    username: string | null
    image: string | null
    rs: number
    role?: 'USER' | 'RESOLVER' | 'ADMIN'
  }
  reactions: Array<{
    id: string
    type: 'LIKE' | 'INSIGHTFUL' | 'DISAGREE'
    user: {
      id: string
      name: string | null
      username: string | null
    }
  }>
  _count: {
    replies: number
  }
}

interface CommentThreadProps {
  predictionId?: string
  initialComments?: Comment[]
}

export default function CommentThread({ predictionId, initialComments }: CommentThreadProps) {
  const { data: session } = useSession()
  const t = useTranslations('comments')
  const [comments, setComments] = useState<Comment[]>(initialComments ?? [])
  const [isLoading, setIsLoading] = useState(initialComments == null)

  useEffect(() => {
    // Server already pre-fetched the thread for SEO; skip the redundant client fetch.
    if (initialComments != null) return

    const fetchComments = async () => {
      try {
        const params = new URLSearchParams()
        if (predictionId) params.set('predictionId', predictionId)

        const response = await fetch(`/api/comments?${params}`)
        if (response.ok) {
          const data = await response.json()
          setComments(data.comments || [])
        }
      } catch (error) {
        log.error({ err: error }, 'Error fetching comments')
      } finally {
        setIsLoading(false)
      }
    }

    fetchComments()
  }, [predictionId, initialComments])

  const handleCommentAdded = (newComment: Comment) => {
    setComments([newComment, ...comments])
  }

  const handleCommentDeleted = (commentId: string) => {
    setComments(comments.filter(c => c.id !== commentId))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <MessageSquare className="w-5 h-5 text-gray-500" />
        <h3 className="text-lg font-semibold text-white">
          {t('discussion', { count: comments.length })}
        </h3>
      </div>

      {/* Comment Form */}
      {session && (
        <CommentForm
          predictionId={predictionId}
          onCommentAdded={handleCommentAdded}
        />
      )}

      {/* Comments List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
        </div>
      ) : comments.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>{t('noComments')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              predictionId={predictionId}
              onDeleted={handleCommentDeleted}
            />
          ))}
        </div>
      )}
    </div>
  )
}

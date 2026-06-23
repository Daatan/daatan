'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useLocale, useTranslations } from 'next-intl'
import { formatDistanceToNow } from 'date-fns'
import { dateFnsLocale } from '@/lib/utils/date-fns-locale'
import { ThumbsUp, Lightbulb, ThumbsDown, Reply, Trash2, Edit2, MessageSquare, Loader2, Languages, Info } from 'lucide-react'
import CommentForm from './CommentForm'
import type { Comment } from './CommentThread'
import { RoleBadge } from '@/components/RoleBadge'
import { UserLink } from '@/components/UserLink'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('CommentItem')

interface CommentItemProps {
  comment: Comment
  predictionId?: string
  onDeleted: (commentId: string) => void
  isReply?: boolean
}

export default function CommentItem({
  comment,
  predictionId,
  onDeleted,
  isReply = false,
}: CommentItemProps) {
  const { data: session } = useSession()
  const locale = useLocale()
  const t = useTranslations('translate')
  const tc = useTranslations('comments')
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(comment.text)
  const [replies, setReplies] = useState<Comment[]>([])
  const [showReplies, setShowReplies] = useState(false)
  const [isLoadingReplies, setIsLoadingReplies] = useState(false)
  const [reactions, setReactions] = useState(comment.reactions)
  const [translatedText, setTranslatedText] = useState<string | null>(null)
  const [isTranslating, setIsTranslating] = useState(false)

  const showTranslateButton = locale !== 'en'

  const handleTranslate = async () => {
    if (translatedText) {
      setTranslatedText(null)
      return
    }
    setIsTranslating(true)
    try {
      const response = await fetch(`/api/comments/${comment.id}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: locale }),
      })
      if (response.ok) {
        const data = await response.json()
        setTranslatedText(data.translatedText)
      }
    } catch (err) {
      log.error({ err }, 'Failed to translate comment')
    } finally {
      setIsTranslating(false)
    }
  }

  const isAuthor = session?.user?.id === comment.author.id
  const canDelete = isAuthor || session?.user?.role === 'ADMIN' || session?.user?.role === 'RESOLVER'

  const reactionCounts = {
    LIKE: reactions.filter(r => r.type === 'LIKE').length,
    INSIGHTFUL: reactions.filter(r => r.type === 'INSIGHTFUL').length,
    DISAGREE: reactions.filter(r => r.type === 'DISAGREE').length,
  }

  const userReaction = reactions.find(r => r.user.id === session?.user?.id)

  const handleReact = async (type: 'LIKE' | 'INSIGHTFUL' | 'DISAGREE') => {
    if (!session) return

    try {
      if (userReaction?.type === type) {
        // Remove reaction
        const response = await fetch(`/api/comments/${comment.id}/react`, {
          method: 'DELETE',
        })
        if (response.ok) {
          setReactions(reactions.filter(r => r.user.id !== session.user.id))
        }
      } else {
        // Add or update reaction
        const response = await fetch(`/api/comments/${comment.id}/react`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type }),
        })
        if (response.ok) {
          const newReaction = await response.json()
          setReactions([
            ...reactions.filter(r => r.user.id !== session.user.id),
            newReaction,
          ])
        }
      }
    } catch (error) {
        log.error({ err: error }, 'Error reacting')
    }
  }

  const handleDelete = async () => {
    if (!confirm(tc('deleteConfirm'))) return

    try {
      const response = await fetch(`/api/comments/${comment.id}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        onDeleted(comment.id)
      }
    } catch (error) {
        log.error({ err: error }, 'Error deleting comment')
    }
  }

  const handleUpdate = async () => {
    try {
      const response = await fetch(`/api/comments/${comment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: editText }),
      })
      if (response.ok) {
        setIsEditing(false)
        comment.text = editText
      }
    } catch (error) {
        log.error({ err: error }, 'Error updating comment')
    }
  }

  const loadReplies = async () => {
    if (showReplies) {
      setShowReplies(false)
      return
    }

    setIsLoadingReplies(true)
    try {
      const params = new URLSearchParams({ parentId: comment.id })
      if (predictionId) params.set('predictionId', predictionId)
      const response = await fetch(`/api/comments?${params}`)
      if (response.ok) {
        const data = await response.json()
        setReplies(data.comments || [])
        setShowReplies(true)
      }
    } catch (error) {
        log.error({ err: error }, 'Error loading replies')
    } finally {
      setIsLoadingReplies(false)
    }
  }

  const handleReplyAdded = (reply: Comment) => {
    setReplies([reply, ...replies])
    setShowReplyForm(false)
    setShowReplies(true)
    comment._count.replies++
  }

  return (
    <div className={`${isReply ? 'ml-8' : ''}`}>
      <div className="flex gap-3">
        <UserLink 
          userId={comment.author.id}
          username={comment.author.username}
          name={comment.author.name}
          image={comment.author.image}
          showAvatar={true}
          avatarSize={32}
        >
          {/* Empty children so it only renders the avatar */}
          <span />
        </UserLink>
        
        <div className="flex-1 space-y-2">
          {/* Header */}
          <div className="flex items-center gap-2 text-sm">
            <div className="flex items-center gap-2">
              <UserLink 
                userId={comment.author.id}
                username={comment.author.username}
                name={comment.author.name}
                className="font-semibold text-white"
              />
              {comment.author.role && (
                <RoleBadge role={comment.author.role} size="sm" />
              )}
            </div>
            <span className="text-gray-500">·</span>
            <span className="text-gray-500">
              {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true, locale: dateFnsLocale(locale) })}
            </span>
            {comment.updatedAt !== comment.createdAt && (
              <span className="text-gray-400 text-xs">{tc('edited')}</span>
            )}
          </div>

          {/* Content */}
          {isEditing ? (
            <div className="space-y-2">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                rows={3}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleUpdate}
                  className="px-3 py-1 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                >
                  {tc('save')}
                </button>
                <button
                  onClick={() => {
                    setIsEditing(false)
                    setEditText(comment.text)
                  }}
                  className="px-3 py-1 text-text-secondary text-sm hover:bg-navy-700 rounded-lg"
                >
                  {tc('cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-mist whitespace-pre-wrap">{translatedText ?? comment.text}</p>
              {translatedText && (
                <div className="flex items-center gap-1.5 text-[10px] text-blue-600/70 italic bg-cobalt/10/30 px-2 py-1 rounded w-fit">
                  <Info className="w-3 h-3" />
                  <span>{t('disclaimer')}</span>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-4 text-sm">
            {/* Reactions */}
            <button
              onClick={() => handleReact('LIKE')}
              disabled={!session}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-colors ${
                userReaction?.type === 'LIKE'
                  ? 'bg-blue-100 text-blue-600'
                  : 'text-gray-400 hover:bg-navy-700'
              } disabled:opacity-50`}
            >
              <ThumbsUp className="w-4 h-4" />
              {reactionCounts.LIKE > 0 && <span>{reactionCounts.LIKE}</span>}
            </button>

            <button
              onClick={() => handleReact('INSIGHTFUL')}
              disabled={!session}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-colors ${
                userReaction?.type === 'INSIGHTFUL'
                  ? 'bg-yellow-100 text-yellow-600'
                  : 'text-gray-400 hover:bg-navy-700'
              } disabled:opacity-50`}
            >
              <Lightbulb className="w-4 h-4" />
              {reactionCounts.INSIGHTFUL > 0 && <span>{reactionCounts.INSIGHTFUL}</span>}
            </button>

            <button
              onClick={() => handleReact('DISAGREE')}
              disabled={!session}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-colors ${
                userReaction?.type === 'DISAGREE'
                  ? 'bg-red-100 text-red-600'
                  : 'text-gray-400 hover:bg-navy-700'
              } disabled:opacity-50`}
            >
              <ThumbsDown className="w-4 h-4" />
              {reactionCounts.DISAGREE > 0 && <span>{reactionCounts.DISAGREE}</span>}
            </button>

            {/* Reply */}
            {!isReply && session && (
              <button
                onClick={() => setShowReplyForm(!showReplyForm)}
                className="flex items-center gap-1 px-2 py-1 text-gray-400 hover:bg-navy-700 rounded-lg transition-colors"
              >
                <Reply className="w-4 h-4" />
                {tc('reply')}
              </button>
            )}

            {/* Translate */}
            {showTranslateButton && !isEditing && (
              <button
                onClick={handleTranslate}
                disabled={isTranslating}
                className="flex items-center gap-1 px-2 py-1 text-gray-400 hover:bg-navy-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {isTranslating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Languages className="w-4 h-4" />
                )}
                {translatedText ? t('showOriginal') : t('translate')}
              </button>
            )}

            {/* Edit/Delete */}
            {(isAuthor || canDelete) && !isEditing && (
              <>
                {isAuthor && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="flex items-center gap-1 px-2 py-1 text-gray-400 hover:bg-navy-700 rounded-lg transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                    {tc('edit')}
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={handleDelete}
                    className="flex items-center gap-1 px-2 py-1 text-red-600 hover:bg-red-900/20 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    {tc('delete')}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Reply Form */}
          {showReplyForm && (
            <div className="mt-3">
              <CommentForm
                predictionId={predictionId}
                parentId={comment.id}
                onCommentAdded={handleReplyAdded}
                onCancel={() => setShowReplyForm(false)}
                placeholder={tc('writeReply')}
              />
            </div>
          )}

          {/* Show Replies Button */}
          {!isReply && comment._count.replies > 0 && (
            <button
              onClick={loadReplies}
              disabled={isLoadingReplies}
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-cobalt-light font-medium"
            >
              <MessageSquare className="w-4 h-4" />
              {isLoadingReplies
                ? tc('loading')
                : showReplies
                ? tc('hideReplies')
                : tc('showReplies', { count: comment._count.replies })}
            </button>
          )}

          {/* Replies */}
          {showReplies && replies.length > 0 && (
            <div className="mt-4 space-y-4">
              {replies.map((reply) => (
                <CommentItem
                  key={reply.id}
                  comment={reply}
                  predictionId={predictionId}
                  onDeleted={(id) => setReplies(replies.filter(r => r.id !== id))}
                  isReply
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

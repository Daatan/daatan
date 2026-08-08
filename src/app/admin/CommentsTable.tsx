'use client'
import { useState, useEffect, useCallback } from 'react'
import { Loader2, Search, Trash2, AlertCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { createClientLogger } from '@/lib/client-logger'
import { toast } from 'react-hot-toast'

const log = createClientLogger('CommentsTable')

type AdminComment = {
  id: string
  text: string
  createdAt: string
  deletedAt: string | null
  moderationCheckFailed?: boolean
  author: { id: string; name: string | null; username: string | null; image: string | null }
  prediction: { id: string; slug?: string; claimText: string } | null
  _count: { replies: number; reactions: number }
}

export default function CommentsTable() {
  const t = useTranslations('admin')
  const [comments, setComments] = useState<AdminComment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const fetchComments = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/admin/comments?page=${page}&limit=20&search=${encodeURIComponent(search)}`)
      if (res.ok) {
        const data = await res.json()
        setComments(data.comments)
        setTotalPages(data.pages)
      }
    } finally {
      setIsLoading(false)
    }
  }, [page, search])

  useEffect(() => {
    fetchComments()
  }, [fetchComments])

  const deleteComment = async (id: string) => {
    if (!confirm(t('deleteCommentConfirm'))) return

    try {
      const res = await fetch(`/api/admin/comments/${id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setComments(comments.filter(c => c.id !== id))
        toast.success(t('deleteCommentSuccess'))
      } else {
        toast.error(t('deleteCommentFailed'))
      }
    } catch (err) {
      log.error({ err }, 'Error loading comments')
      toast.error(t('deleteCommentError'))
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    fetchComments()
  }

  return (
    <div>
      <div className="mb-6 flex gap-2">
        <form onSubmit={handleSearch} className="flex gap-2 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchComments')}
              aria-label={t('searchComments')}
              className="pl-10 pr-4 py-2 border rounded-lg w-full focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            {t('view')}
          </button>
        </form>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto border rounded-lg shadow-sm">
            <table className="w-full border-collapse bg-navy-700">
              <thead className="bg-navy-800 text-text-secondary text-sm font-semibold uppercase tracking-wider">
                <tr>
                  <th className="p-3 border-b text-left">{t('colContent')}</th>
                  <th className="p-3 border-b text-left">{t('colAuthor')}</th>
                  <th className="p-3 border-b text-left">{t('colForecast')}</th>
                  <th className="p-3 border-b text-right">{t('colJoined')}</th>
                  <th className="p-3 border-b text-right">{t('colActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {comments.map((c) => (
                  <tr key={c.id} className={`hover:bg-navy-800 transition-colors ${c.deletedAt ? 'opacity-50' : ''}`}>
                    <td className="p-3 max-w-md truncate">
                      {c.moderationCheckFailed && (
                        <span
                          className="inline-flex items-center gap-1 mr-2 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700"
                          title="AI moderation check failed for this content — review it manually"
                        >
                          <AlertCircle className="w-3 h-3" />
                          Needs review
                        </span>
                      )}
                      {c.text}
                    </td>
                    <td className="p-3 text-sm">{c.author.name}</td>
                    <td className="p-3 text-sm max-w-xs truncate">{c.prediction?.claimText || 'N/A'}</td>
                    <td className="p-3 text-right text-xs text-gray-500">{new Date(c.createdAt).toLocaleDateString()}</td>
                    <td className="p-3 text-right">
                      {!c.deletedAt && (
                        <button
                          onClick={() => deleteComment(c.id)}
                          className="text-red-600 hover:text-red-800 p-1 rounded hover:bg-red-900/20"
                          title={t('deleteComment')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                      {c.deletedAt && <span className="text-xs text-red-500 italic">{t('deleted')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex justify-between items-center text-sm text-gray-600">
            <div>{t('pageOf', { page, total: totalPages })}</div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 border rounded disabled:opacity-50 hover:bg-navy-800"
              >
                {t('previous')}
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 border rounded disabled:opacity-50 hover:bg-navy-800"
              >
                {t('next')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

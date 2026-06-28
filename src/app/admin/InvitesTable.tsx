'use client'
import { useState, useEffect, useCallback } from 'react'
import { Loader2, Plus, Copy, Trash2 } from 'lucide-react'
import { toast } from 'react-hot-toast'

type Invite = {
  id: string
  createdAt: string
  acceptedAt: string | null
}

export default function InvitesTable() {
  const [invites, setInvites] = useState<Invite[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [lastUrl, setLastUrl] = useState<string | null>(null)

  const fetchInvites = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/admin/invites')
      if (res.ok) setInvites((await res.json()).invites)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchInvites()
  }, [fetchInvites])

  const copy = (url: string) => {
    navigator.clipboard.writeText(url).then(
      () => toast.success('Invite link copied'),
      () => toast.error('Could not copy to clipboard'),
    )
  }

  const createInvite = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/admin/invites', { method: 'POST' })
      if (!res.ok) {
        toast.error('Failed to create invite')
        return
      }
      const data = await res.json()
      setLastUrl(data.url)
      copy(data.url)
      fetchInvites()
    } finally {
      setCreating(false)
    }
  }

  const revoke = async (id: string) => {
    const res = await fetch(`/api/admin/invites/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setInvites((prev) => prev.filter((i) => i.id !== id))
      toast.success('Invite revoked')
    } else {
      toast.error('Failed to revoke invite')
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500 max-w-2xl">
          Single-use invite links for people who don&apos;t sign in via SSO. Create a link, send it
          to the person, and they set a password on signup. Each link works once.
        </p>
        <button
          onClick={createInvite}
          disabled={creating}
          className="shrink-0 inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Create invite
        </button>
      </div>

      {lastUrl && (
        <div className="mb-6 flex items-center gap-2 bg-navy-800 border border-navy-600 rounded-lg p-3">
          <code className="flex-1 text-xs text-blue-300 break-all font-mono">{lastUrl}</code>
          <button
            onClick={() => copy(lastUrl)}
            className="shrink-0 inline-flex items-center gap-1.5 text-sm text-gray-300 hover:text-white px-2 py-1"
          >
            <Copy className="w-4 h-4" /> Copy
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : invites.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-sm">No invites yet.</div>
      ) : (
        <div className="overflow-x-auto border rounded-lg shadow-sm">
          <table className="w-full border-collapse bg-navy-700">
            <thead className="bg-navy-800 text-text-secondary text-sm font-semibold uppercase tracking-wider">
              <tr>
                <th className="p-3 border-b text-left">Status</th>
                <th className="p-3 border-b text-right">Created</th>
                <th className="p-3 border-b text-right">Accepted</th>
                <th className="p-3 border-b text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invites.map((inv) => (
                <tr key={inv.id} className="hover:bg-navy-800 transition-colors">
                  <td className="p-3">
                    {inv.acceptedAt ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-green-900/20 text-green-400">Accepted</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded bg-amber-900/20 text-amber-400">Pending</span>
                    )}
                  </td>
                  <td className="p-3 text-right text-xs text-gray-500">{new Date(inv.createdAt).toLocaleString()}</td>
                  <td className="p-3 text-right text-xs text-gray-500">
                    {inv.acceptedAt ? new Date(inv.acceptedAt).toLocaleString() : '—'}
                  </td>
                  <td className="p-3 text-right">
                    {!inv.acceptedAt && (
                      <button
                        onClick={() => revoke(inv.id)}
                        className="inline-flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300 px-2 py-1"
                      >
                        <Trash2 className="w-4 h-4" /> Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

'use client'
import { useState, useEffect, useCallback } from 'react'
import { Loader2, CheckCircle, XCircle, ExternalLink, Bot } from 'lucide-react'
import { toast } from 'react-hot-toast'
import Link from 'next/link'
import Image from 'next/image'
import { UserLink } from '@/components/UserLink'

type PendingForecast = {
    id: string
    claimText: string
    slug: string | null
    status: string
    outcomeType: string
    resolveByDatetime: string
    createdAt: string
    publishedAt: string | null
    author: {
        id: string
        name: string | null
        username: string | null
        email: string
        image: string | null
        isBot: boolean
    }
    _count: { commitments: number; comments: number }
}

export default function ApprovalsPage() {
    const [predictions, setPredictions] = useState<PendingForecast[]>([])
    const [total, setTotal] = useState(0)
    const [isLoading, setIsLoading] = useState(true)
    const [actioningId, setActioningId] = useState<string | null>(null)
    const [isBulkActioning, setIsBulkActioning] = useState(false)
    const [resolvedIds, setResolvedIds] = useState<Record<string, 'approved' | 'rejected'>>({})
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

    const fetchPending = useCallback(async () => {
        setIsLoading(true)
        try {
            const res = await fetch('/api/admin/approvals')
            if (res.ok) {
                const data = await res.json()
                setPredictions(data.predictions)
                setTotal(data.total)
            }
        } catch {
            // silent
        } finally {
            setIsLoading(false)
        }
    }, [])

    useEffect(() => { fetchPending() }, [fetchPending])

    const unresolvedIds = predictions
        .filter((p) => !resolvedIds[p.id])
        .map((p) => p.id)

    const allSelected = unresolvedIds.length > 0 && unresolvedIds.every((id) => selectedIds.has(id))

    const toggleSelectAll = () => {
        if (allSelected) {
            setSelectedIds(new Set())
        } else {
            setSelectedIds(new Set(unresolvedIds))
        }
    }

    const toggleSelect = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev)
            next.has(id) ? next.delete(id) : next.add(id)
            return next
        })
    }

    const removeResolved = (id: string) => {
        setTimeout(() => {
            setPredictions((prev) => prev.filter((p) => p.id !== id))
            setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next })
        }, 800)
    }

    const handleApprove = async (id: string) => {
        setActioningId(id)
        try {
            const res = await fetch(`/api/forecasts/${id}/approve`, { method: 'POST' })
            if (res.ok) {
                setResolvedIds((prev) => ({ ...prev, [id]: 'approved' }))
                setTotal((prev) => prev - 1)
                toast.success('Forecast approved')
                removeResolved(id)
            } else {
                const data = await res.json().catch(() => ({}))
                toast.error(data.error || 'Failed to approve forecast')
            }
        } catch {
            toast.error('Network error — failed to approve')
        } finally {
            setActioningId(null)
        }
    }

    const handleReject = async (id: string) => {
        if (!confirm('Reject this forecast? It will be moved to VOID status.')) return
        setActioningId(id)
        try {
            const res = await fetch(`/api/forecasts/${id}/reject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keywords: [], description: '' }),
            })
            if (res.ok) {
                setResolvedIds((prev) => ({ ...prev, [id]: 'rejected' }))
                setTotal((prev) => prev - 1)
                toast.success('Forecast rejected')
                removeResolved(id)
            } else {
                const data = await res.json().catch(() => ({}))
                toast.error(data.error || 'Failed to reject forecast')
            }
        } catch {
            toast.error('Network error — failed to reject')
        } finally {
            setActioningId(null)
        }
    }

    const handleBulkApprove = async () => {
        const ids = [...selectedIds]
        if (!confirm(`Approve ${ids.length} selected forecast${ids.length !== 1 ? 's' : ''}?`)) return
        setIsBulkActioning(true)
        setSelectedIds(new Set())
        let approved = 0
        for (const id of ids) {
            try {
                const res = await fetch(`/api/forecasts/${id}/approve`, { method: 'POST' })
                if (res.ok) {
                    setResolvedIds((prev) => ({ ...prev, [id]: 'approved' }))
                    setTotal((prev) => prev - 1)
                    removeResolved(id)
                    approved++
                }
            } catch { /* continue */ }
        }
        toast.success(`Approved ${approved} of ${ids.length} forecasts`)
        setIsBulkActioning(false)
    }

    const handleBulkReject = async () => {
        const ids = [...selectedIds]
        if (!confirm(`Reject ${ids.length} selected forecast${ids.length !== 1 ? 's' : ''}? They will be moved to VOID status.`)) return
        setIsBulkActioning(true)
        setSelectedIds(new Set())
        let rejected = 0
        for (const id of ids) {
            try {
                const res = await fetch(`/api/forecasts/${id}/reject`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ keywords: [], description: '' }),
                })
                if (res.ok) {
                    setResolvedIds((prev) => ({ ...prev, [id]: 'rejected' }))
                    setTotal((prev) => prev - 1)
                    removeResolved(id)
                    rejected++
                }
            } catch { /* continue */ }
        }
        toast.success(`Rejected ${rejected} of ${ids.length} forecasts`)
        setIsBulkActioning(false)
    }

    const handleApproveAll = async () => {
        if (!confirm(`Approve all ${unresolvedIds.length} pending forecasts?`)) return
        setIsBulkActioning(true)
        setSelectedIds(new Set())
        let approved = 0
        for (const id of unresolvedIds) {
            try {
                const res = await fetch(`/api/forecasts/${id}/approve`, { method: 'POST' })
                if (res.ok) {
                    setResolvedIds((prev) => ({ ...prev, [id]: 'approved' }))
                    setTotal((prev) => prev - 1)
                    removeResolved(id)
                    approved++
                }
            } catch { /* continue */ }
        }
        toast.success(`Approved ${approved} forecasts`)
        setIsBulkActioning(false)
    }

    const isActioning = isBulkActioning || actioningId !== null

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h2 className="text-xl font-bold text-white">Pending Approvals</h2>
                    <p className="text-sm text-gray-500 mt-1">
                        Forecasts awaiting human review before going live.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {selectedIds.size > 0 && (
                        <>
                            <button
                                onClick={handleBulkApprove}
                                disabled={isActioning}
                                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                            >
                                {isBulkActioning ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                                Approve selected ({selectedIds.size})
                            </button>
                            <button
                                onClick={handleBulkReject}
                                disabled={isActioning}
                                className="flex items-center gap-1.5 px-4 py-2 bg-navy-700 border border-red-800/50 text-red-500 text-sm font-medium rounded-lg hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                            >
                                <XCircle className="w-4 h-4" />
                                Reject selected ({selectedIds.size})
                            </button>
                        </>
                    )}
                    {selectedIds.size === 0 && unresolvedIds.length > 1 && (
                        <button
                            onClick={handleApproveAll}
                            disabled={isActioning}
                            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                            {isBulkActioning ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                            Approve All ({unresolvedIds.length})
                        </button>
                    )}
                </div>
            </div>

            {/* Select-all row */}
            {!isLoading && unresolvedIds.length > 0 && (
                <div className="flex items-center gap-2 mb-3 px-1">
                    <input
                        type="checkbox"
                        id="select-all"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 accent-blue-500 cursor-pointer"
                    />
                    <label htmlFor="select-all" className="text-sm text-gray-400 cursor-pointer select-none">
                        {allSelected ? 'Deselect all' : `Select all (${unresolvedIds.length})`}
                    </label>
                </div>
            )}

            {isLoading ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                </div>
            ) : predictions.length === 0 ? (
                <div className="text-center py-16">
                    <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
                    <p className="text-gray-500 font-medium">All clear!</p>
                    <p className="text-sm text-gray-400 mt-1">No forecasts pending approval.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {predictions.map((p) => {
                        const resolved = resolvedIds[p.id]
                        const isApproved = resolved === 'approved'
                        const isRejected = resolved === 'rejected'
                        const isSelected = selectedIds.has(p.id)

                        return (
                        <div
                            key={p.id}
                            className={`rounded-xl p-4 transition-all shadow-sm ${
                                isApproved
                                    ? 'bg-teal/10 border-2 border-green-400 opacity-75'
                                    : isRejected
                                    ? 'bg-red-900/20 border-2 border-red-300 opacity-75'
                                    : isSelected
                                    ? 'bg-navy-700 border-2 border-blue-500'
                                    : 'bg-navy-700 border border-amber-700/40 hover:border-amber-300'
                            }`}
                        >
                            {/* Approved / Rejected banner */}
                            {resolved && (
                                <div className={`flex items-center gap-2 mb-3 px-3 py-2 rounded-lg text-sm font-semibold ${
                                    isApproved ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                }`}>
                                    {isApproved ? (
                                        <><CheckCircle className="w-5 h-5" /> Approved — now ACTIVE</>
                                    ) : (
                                        <><XCircle className="w-5 h-5" /> Rejected — moved to VOID</>
                                    )}
                                </div>
                            )}

                            <div className="flex items-start gap-3">
                                {/* Checkbox */}
                                {!resolved && (
                                    <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => toggleSelect(p.id)}
                                        className="mt-1 w-4 h-4 accent-blue-500 cursor-pointer shrink-0"
                                    />
                                )}

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <UserLink
                                            userId={p.author.id}
                                            username={p.author.username}
                                            name={p.author.name}
                                            image={p.author.image}
                                            showAvatar={true}
                                            avatarSize={20}
                                        >
                                            <span className="text-sm font-medium text-text-secondary">
                                                {p.author.username || p.author.name || 'Anon'}
                                            </span>
                                        </UserLink>
                                        {p.author.isBot && (
                                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-indigo-100 text-indigo-700">
                                                <Bot className="w-3 h-3" /> Bot
                                            </span>
                                        )}
                                        <span className="text-xs text-gray-400">
                                            {new Date(p.createdAt).toLocaleDateString()} {new Date(p.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>

                                    <Link
                                        href={`/forecasts/${p.slug || p.id}`}
                                        className="text-white font-medium hover:text-blue-600 transition-colors line-clamp-2"
                                    >
                                        {p.claimText}
                                    </Link>

                                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                                        {!resolved && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-900/20 text-amber-400 font-medium">
                                                Pending Approval
                                            </span>
                                        )}
                                        <span>{p._count.commitments} stakes</span>
                                        <span>{p._count.comments} comments</span>
                                        <span>Resolves: {new Date(p.resolveByDatetime).toLocaleDateString()}</span>
                                    </div>
                                </div>

                                {/* Per-item actions — hidden once resolved */}
                                {!resolved && (
                                    <div className="flex items-center gap-2 shrink-0">
                                        <Link
                                            href={`/forecasts/${p.slug || p.id}`}
                                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-cobalt/10 rounded-lg transition-colors"
                                            title="View forecast"
                                        >
                                            <ExternalLink className="w-4 h-4" />
                                        </Link>
                                        <button
                                            onClick={() => handleApprove(p.id)}
                                            disabled={isActioning}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                                            title="Approve — set to ACTIVE"
                                        >
                                            {actioningId === p.id ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : (
                                                <CheckCircle className="w-4 h-4" />
                                            )}
                                            Approve
                                        </button>
                                        <button
                                            onClick={() => handleReject(p.id)}
                                            disabled={isActioning}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-navy-700 border border-red-800/50 text-red-600 text-sm font-medium rounded-lg hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                                            title="Reject — set to VOID"
                                        >
                                            <XCircle className="w-4 h-4" />
                                            Reject
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                        )
                    })}

                    <p className="text-xs text-gray-400 text-center pt-2">
                        {total} forecast{total !== 1 ? 's' : ''} pending approval
                    </p>
                </div>
            )}
        </div>
    )
}

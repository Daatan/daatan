'use client'
import { useState, useEffect, useCallback } from 'react'
import { Loader2, Search } from 'lucide-react'
import ForecastCard, { Prediction } from '@/components/forecasts/ForecastCard'
import BackfillTagsButton from './BackfillTagsButton'

export default function ForecastsTable() {
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const fetchPredictions = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/admin/forecasts?page=${page}&limit=20&search=${encodeURIComponent(search)}`)
      if (res.ok) {
        const data = await res.json()
        setPredictions(data.predictions)
        setTotalPages(data.pages)
      }
    } finally {
      setIsLoading(false)
    }
  }, [page, search])

  useEffect(() => {
    fetchPredictions()
  }, [fetchPredictions])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    fetchPredictions()
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
              placeholder="Search by claim, author, or email..."
              aria-label="Search by claim, author, or email..."
              className="pl-10 pr-4 py-2 border rounded-lg w-full focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            Search
          </button>
        </form>
        <BackfillTagsButton />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {predictions.map((p) => (
              <ForecastCard key={p.id} prediction={p} showModerationControls={true} />
            ))}
          </div>

          <div className="mt-4 flex justify-between items-center text-sm text-gray-600">
            <div>Page {page} of {totalPages}</div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 border rounded disabled:opacity-50 hover:bg-navy-800"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 border rounded disabled:opacity-50 hover:bg-navy-800"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

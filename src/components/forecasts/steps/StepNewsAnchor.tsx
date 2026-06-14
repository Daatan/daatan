'use client'

import { useState, useEffect, useCallback } from 'react'
import { Link as LinkIcon, X, ExternalLink, Loader2, Wand2, CheckCircle2 } from 'lucide-react'
import type { PredictionFormData } from '../ForecastWizard'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('StepNewsAnchor')

type Props = {
  formData: PredictionFormData
  updateFormData: (updates: Partial<PredictionFormData>) => void
}

type NewsAnchor = {
  id: string
  url: string
  title: string
  source?: string
  imageUrl?: string
  _count: { predictions: number }
}

export const StepNewsAnchor = ({ formData, updateFormData }: Props) => {
  const [url, setUrl] = useState(formData.newsAnchorUrl || '')
  const [title, setTitle] = useState(formData.newsAnchorTitle || '')
  const [isSearching, setIsSearching] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)
  const [selectedAnchor, setSelectedAnchor] = useState<NewsAnchor | null>(null)
  const [skipNews, setSkipNews] = useState(!formData.newsAnchorId && !formData.newsAnchorUrl)
  const [marketImport, setMarketImport] = useState<{ providerLabel: string; question: string; url: string } | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  const isUrl = /^https?:\/\/[^\s]+$/i.test(url.trim())
  // A pasted Polymarket/Kalshi market URL is imported into the forecast, not treated as a news anchor.
  const isMarketUrl = /^https?:\/\/(www\.)?(polymarket|kalshi)\.com\//i.test(url.trim())

  const handleSelectAnchor = useCallback((anchor: NewsAnchor) => {
    setSelectedAnchor(anchor)
    setUrl(anchor.url)
    setTitle(anchor.title)
    updateFormData({
      newsAnchorId: anchor.id,
      newsAnchorUrl: anchor.url,
      newsAnchorTitle: anchor.title,
    })
  }, [updateFormData])

  // Auto-fetch title when URL is pasted
  useEffect(() => {
    const fetchTitle = async () => {
      if (isUrl && !isMarketUrl && !title && !isSearching && !isExtracting) {
        setIsSearching(true)
        try {
          const response = await fetch(`/api/news-anchors?url=${encodeURIComponent(url.trim())}`)
          if (response.ok) {
            const data = await response.json()
            const existingAnchor = data.anchors?.[0]
            if (existingAnchor) {
              setTitle(existingAnchor.title)
              handleSelectAnchor(existingAnchor)
            } else if (!title) {
              // Extract a basic title from the URL path as a last resort
              try {
                const urlObj = new URL(url.trim())
                const pathParts = urlObj.pathname.split('/').filter(Boolean)
                if (pathParts.length > 0) {
                  const lastPart = pathParts[pathParts.length - 1]
                  const readableTitle = lastPart
                    .replace(/[-_]/g, ' ')
                    .replace(/\.[^/.]+$/, '') // remove extension
                    .replace(/\b\w/g, l => l.toUpperCase()) // capitalize
                  if (readableTitle.length > 5) setTitle(readableTitle)
                }
              } catch {
                // ignore
              }
            }
          }
        } catch (error) {
          log.warn({ err: error }, 'Failed to fetch article title')
        } finally {
          setIsSearching(false)
        }
      }
    }

    const timer = setTimeout(fetchTitle, 500)
    return () => clearTimeout(timer)
  }, [url, isUrl, isMarketUrl, title, isSearching, isExtracting, handleSelectAnchor])

  // Auto-import a pasted Polymarket/Kalshi URL → prefill the forecast from the market.
  useEffect(() => {
    if (!isMarketUrl || formData.externalMarketId || isImporting) return
    const timer = setTimeout(async () => {
      setIsImporting(true)
      try {
        const res = await fetch('/api/forecasts/import-market', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.trim() }),
        })
        if (res.ok) {
          const data = await res.json()
          setMarketImport({ providerLabel: data.providerLabel, question: data.claimText, url: data.url })
          updateFormData({
            externalMarketId: data.externalMarketId,
            claimText: data.claimText,
            // ISO → YYYY-MM-DD for the date input; only when the market has an end date.
            ...(data.resolveByDatetime ? { resolveByDatetime: data.resolveByDatetime.slice(0, 10) } : {}),
          })
          setSkipNews(true)
        } else {
          const d = await res.json().catch(() => ({}))
          log.warn({ status: res.status, error: d.error }, 'Market import failed')
        }
      } catch (e) {
        log.warn({ err: e }, 'Market import errored')
      } finally {
        setIsImporting(false)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [url, isMarketUrl, formData.externalMarketId, isImporting, updateFormData])

  const handleUrlSubmit = async () => {
    if (!url) return

    setIsSearching(true)
    try {
      // Check if anchor exists or create new one
      const response = await fetch('/api/news-anchors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          title: title || 'Untitled Article',
        }),
      })

      if (response.ok) {
        const anchor = await response.json()
        setSelectedAnchor(anchor)
        updateFormData({
          newsAnchorId: anchor.id,
          newsAnchorUrl: anchor.url,
          newsAnchorTitle: anchor.title,
        })
      }
    } catch (error) {
      log.error({ err: error }, 'Error creating news anchor')
    } finally {
      setIsSearching(false)
    }
  }

  const handleMagicExtract = async () => {
    if (!url) return

    setIsExtracting(true)
    try {
      // First, ensure the news anchor exists
      const anchorResponse = await fetch('/api/news-anchors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          title: title || 'Untitled Article',
        }),
      })

      let anchorId: string | undefined
      if (anchorResponse.ok) {
        const anchor = await anchorResponse.json()
        anchorId = anchor.id
        setSelectedAnchor(anchor)
      }

      // Now call AI extraction
      const aiResponse = await fetch('/api/ai/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })

      if (aiResponse.ok) {
        const data = await aiResponse.json()
        updateFormData({
          newsAnchorId: anchorId,
          newsAnchorUrl: url,
          newsAnchorTitle: title || data.claim.substring(0, 50),
          claimText: data.claim,
          resolveByDatetime: data.resolutionDate,
          outcomeType: data.outcomeOptions?.length > 2 ? 'MULTIPLE_CHOICE' : 'BINARY',
          outcomeOptions: data.outcomeOptions,
        })
      }
    } catch (error) {
      log.error({ err: error }, 'Magic extract error')
    } finally {
      setIsExtracting(false)
    }
  }

  const handleClear = () => {
    setSelectedAnchor(null)
    setUrl('')
    setTitle('')
    updateFormData({
      newsAnchorId: undefined,
      newsAnchorUrl: undefined,
      newsAnchorTitle: undefined,
    })
  }

  const handleSkipNewsToggle = (checked: boolean) => {
    setSkipNews(checked)
    if (checked) {
      // Clear news anchor data when skipping
      handleClear()
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-2">
          Select News Anchor
        </h2>
        <p className="text-gray-500">
          Link your prediction to a specific news story or event. This provides context and helps with resolution.
        </p>
      </div>

      {selectedAnchor ? (
        <div className="p-4 bg-cobalt/10 border border-cobalt/30 rounded-lg">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="font-medium text-white">{selectedAnchor.title}</h3>
              <a
                href={selectedAnchor.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline flex items-center gap-1 mt-1"
              >
                {selectedAnchor.source || new URL(selectedAnchor.url).hostname}
                <ExternalLink className="w-3 h-3" />
              </a>
              {selectedAnchor._count.predictions > 0 && (
                <p className="text-xs text-gray-500 mt-2">
                  {selectedAnchor._count.predictions} prediction{selectedAnchor._count.predictions > 1 ? 's' : ''} linked
                </p>
              )}
            </div>
            <button
              onClick={handleClear}
              className="p-1 text-gray-400 hover:text-gray-600"
              aria-label="Remove anchor"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label htmlFor="url" className="block text-sm font-medium text-text-secondary mb-2">
              Article URL
            </label>
            <div className="relative">
              <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="url"
                id="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/article"
                className={`w-full pl-10 pr-4 py-3 rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${isUrl ? 'border-blue-300 bg-cobalt/10/30' : 'border-navy-600'}`}
              />
            </div>
            {isMarketUrl && (
              <p className="mt-2 text-xs text-pink-400 flex items-center gap-1.5">
                {isImporting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {isImporting ? 'Importing market…' : 'Prediction market detected — importing as a forecast.'}
              </p>
            )}
          </div>

          {marketImport && (
            <div className="p-4 rounded-lg border border-pink-500/40 bg-pink-500/5">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-pink-400 mb-1.5">
                <CheckCircle2 className="w-4 h-4" />
                Imported from {marketImport.providerLabel}
              </div>
              <p className="text-sm text-text-secondary">
                The claim and resolution date were prefilled from this market. You can edit them in the next steps.
              </p>
              <a
                href={marketImport.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-pink-400 hover:text-pink-300"
              >
                View market <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          <div className={`transition-all duration-300 origin-top ${isUrl && !isMarketUrl ? 'opacity-100 max-h-40' : 'opacity-0 max-h-0 overflow-hidden'}`}>
            <label htmlFor="title" className="block text-sm font-medium text-text-secondary mb-2">
              Article Title
            </label>
            <div className="relative">
              <input
                type="text"
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={isSearching ? 'Fetching title...' : 'Enter article headline'}
                disabled={isSearching}
                className="w-full px-4 py-3 rounded-lg border border-navy-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-navy-800"
              />
              {isSearching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-blue-500" />
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleMagicExtract}
              disabled={!isUrl || isSearching || isExtracting}
              className="flex-[2] py-3.5 px-6 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold hover:from-blue-700 hover:to-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm hover:shadow-md active:scale-[0.98]"
            >
              {isExtracting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>AI is working its magic...</span>
                </>
              ) : (
                <>
                  <Wand2 className="w-5 h-5" />
                  <span>AI Magic Extract</span>
                </>
              )}
            </button>

            <button
              onClick={handleUrlSubmit}
              disabled={!isUrl || !title || isSearching || isExtracting}
              className="flex-1 py-3.5 px-6 rounded-xl bg-navy-700 text-text-secondary font-semibold border-2 border-navy-600 hover:bg-navy-800 hover:border-navy-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              Add Manually
            </button>
          </div>
        </div>
      )}

      {!skipNews && (
        <div className="p-4 bg-cobalt/10 border border-cobalt/20 rounded-lg flex items-start gap-3">
          <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
            <Wand2 className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-medium text-blue-900 text-sm">AI Magic Extract</h4>
            <p className="text-sm text-cobalt-light mt-0.5">
              Paste a URL and click Magic Extract. We&apos;ll automatically identify the prediction, resolution date, and options for you.
            </p>
          </div>
        </div>
      )}

      <div className="border-t pt-6">
        <label className="flex items-center gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={skipNews}
            onChange={(e) => handleSkipNewsToggle(e.target.checked)}
            className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-text-secondary group-hover:text-white">
            Create prediction without a URL
          </span>
        </label>
        <p className="text-xs text-gray-500 mt-2 ml-8">
          You can create a prediction based on your own analysis or general knowledge without linking to a specific article.
        </p>
      </div>

      {skipNews && (
        <div className="p-4 bg-teal/10 border border-teal/20 rounded-lg flex items-start gap-3">
          <div className="p-2 bg-green-100 rounded-lg text-green-600">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-medium text-green-900 text-sm">Ready to proceed</h4>
            <p className="text-sm text-teal mt-0.5">
              You can now write your prediction claim and define the resolution criteria.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

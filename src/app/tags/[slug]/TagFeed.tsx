import { Tag as TagIcon } from 'lucide-react'
import ForecastCard, { type Prediction } from '@/components/forecasts/ForecastCard'
import EmptyState from '@/components/ui/EmptyState'
import PaginationLinks from '@/components/ui/PaginationLinks'

interface TagFeedProps {
  tag: { name: string; slug: string }
  predictions: Prediction[]
  total: number
  page: number
  limit: number
}

export default function TagFeed({ tag, predictions, total, page, limit }: TagFeedProps) {
  const totalPages = Math.ceil(total / limit)

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex items-center gap-3 mb-6 lg:mb-8">
        <TagIcon className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500" />
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">{tag.name}</h1>
          <p className="text-sm text-gray-500">
            {total} active forecast{total === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {predictions.length === 0 ? (
        <EmptyState
          variant="dashed"
          icon={<TagIcon className="w-8 h-8 text-gray-400" />}
          iconBgClass="bg-navy-700"
          title={`No active forecasts are tagged "${tag.name}" yet`}
          description="Check back soon, or browse all open forecasts."
          action={{ label: 'Browse forecasts', href: '/forecasts' }}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {predictions.map((prediction) => (
              <ForecastCard key={prediction.id} prediction={prediction} />
            ))}
          </div>

          <PaginationLinks
            base={`/tags/${tag.slug}`}
            page={page}
            totalPages={totalPages}
            labels={{ previous: 'Previous', next: 'Next', status: `Page ${page} of ${totalPages}` }}
          />
        </>
      )}
    </div>
  )
}

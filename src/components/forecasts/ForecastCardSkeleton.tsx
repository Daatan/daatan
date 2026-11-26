export function ForecastCardSkeleton() {
  return (
    <div data-testid="forecast-skeleton" className="p-4 sm:p-5 bg-navy-700 border border-navy-600 rounded-xl animate-pulse">
      <div className="flex gap-4 items-start">
        {/* Speedometer placeholder */}
        <div className="hidden sm:flex flex-col items-center gap-1 shrink-0">
          <div className="w-16 h-10 rounded-lg bg-navy-700" />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Status badge + tags row */}
          <div className="flex items-center gap-2 mb-3">
            <div className="h-5 w-16 bg-navy-700 rounded-full" />
            <div className="h-5 w-12 bg-navy-700 rounded-full" />
            <div className="h-5 w-14 bg-navy-700 rounded-full" />
          </div>

          {/* Claim text (2 lines) */}
          <div className="h-5 bg-navy-700 rounded-sm mb-2 w-full" />
          <div className="h-5 bg-navy-700 rounded-sm mb-4 w-3/4" />

          {/* Footer row */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-navy-700" />
              <div className="h-4 w-20 bg-navy-700 rounded-sm" />
            </div>
            <div className="h-4 w-24 bg-navy-700 rounded-sm" />
            <div className="h-4 w-16 bg-navy-700 rounded-sm" />
          </div>
        </div>

        {/* Chevron placeholder */}
        <div className="w-5 h-5 bg-navy-700 rounded-sm shrink-0 self-center" />
      </div>
    </div>
  )
}

import { Loader2 } from 'lucide-react'

export default function RouteLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
    </div>
  )
}

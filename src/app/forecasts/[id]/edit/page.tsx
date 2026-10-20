import { Suspense, use } from 'react'
import { Loader2 } from 'lucide-react'
import EditForecastClient from './EditForecastClient'


function EditLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
      <p className="text-gray-500 font-medium">Loading editor...</p>
    </div>
  )
}

interface EditForecastPageProps {
  params: Promise<{ id: string }>
}

export default function EditForecastPage({ params }: EditForecastPageProps) {
  const { id } = use(params)
  
  return (
    <Suspense fallback={<EditLoading />}>
      <EditForecastClient id={id} />
    </Suspense>
  )
}

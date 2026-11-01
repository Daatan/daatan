import { redirect } from 'next/navigation'

// daatan#2067: the standalone "Create Manual Forecast" page is gone — /create
// is the single entry point (Express, or the wizard when AI is off).
export default function NewForecastPage() {
  redirect('/create')
}

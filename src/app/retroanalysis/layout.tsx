import type { Metadata } from 'next'
import { retroMetadata } from './metadata'

export function generateMetadata(): Promise<Metadata> {
  return retroMetadata('retroIndex', '/retroanalysis')
}

export default function RetroanalysisLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

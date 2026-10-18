'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useCapabilities } from '@/components/CapabilitiesProvider'
import { analyses } from './data'

const COLUMN_STYLE = {
  left: {
    header: 'bg-teal-600', badge: 'bg-teal-700/30', soft: 'text-teal-100', dot: 'bg-teal-500',
    border: 'border-teal-600', hover: 'hover:bg-teal-50', source: 'text-teal-700',
    icon: 'M5 13l4 4L19 7',
  },
  right: {
    header: 'bg-rose-600', badge: 'bg-rose-700/30', soft: 'text-rose-100', dot: 'bg-rose-500',
    border: 'border-rose-600', hover: 'hover:bg-rose-50', source: 'text-rose-700',
    icon: 'M6 18L18 6M6 6l12 12',
  },
}

export default function RetroanalysisPage() {
  const { selfHosted } = useCapabilities()
  const t = useTranslations('retroIndex')
  const locale = useLocale()
  const [activeAnalysisId, setActiveAnalysisId] = useState(analyses[0].id)

  // SaaS-only marketing archive — not part of the self-hosted edition.
  if (selfHosted) notFound()

  const activeAnalysis = analyses.find(a => a.id === activeAnalysisId) || analyses[0]

  const formatDate = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { dateStyle: 'medium', timeZone: 'UTC' })

  const k = `cases.${activeAnalysis.id}`
  const columns = [
    { key: 'left', side: 'left' as const, items: activeAnalysis.leftItems },
    { key: 'right', side: 'right' as const, items: activeAnalysis.rightItems },
  ]

  return (
    <div className="retro-light min-h-screen bg-[#f5f7fa] text-gray-800 font-sans">
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        {/* Navigation */}
        <div className="flex flex-wrap gap-2 mb-8 justify-center">
          {analyses.map(analysis => (
            <button
              key={analysis.id}
              onClick={() => setActiveAnalysisId(analysis.id)}
              className={`px-4 py-2 rounded-full text-xs md:text-sm font-bold transition-all ${
                activeAnalysisId === analysis.id
                  ? 'bg-gray-900 text-white shadow-md scale-105'
                  : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {t(`nav.${analysis.id}`)}
            </button>
          ))}
        </div>

        {/* Header */}
        <div className="text-center mb-8 animate-fadeIn">
          <span className="inline-block px-4 py-1 bg-gray-900 text-white text-[10px] tracking-widest font-bold rounded-full mb-4 uppercase">
            {t(`${k}.tag`)}
          </span>
          <h1 className="text-3xl md:text-5xl font-extrabold text-gray-900 mb-4 tracking-tight leading-tight">
            {t(`${k}.title`)}
          </h1>
          <p className="text-gray-600 text-sm md:text-base max-w-2xl mx-auto leading-relaxed">
            {t(`${k}.description`)}
          </p>
          {activeAnalysis.reportHref && (
            <Link
              href={activeAnalysis.reportHref}
              className="inline-block mt-6 px-5 py-2.5 rounded-full bg-gray-900 text-white text-xs font-bold tracking-wide hover:bg-gray-700 transition-colors"
            >
              {t('fullReport')}
            </Link>
          )}
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
          {columns.map(({ key, side, items }) => {
            const c = COLUMN_STYLE[side]
            return (
              <div key={key} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
                <div className={`${c.header} p-5 flex justify-between items-center`}>
                  <div className="flex items-center gap-3">
                    <span className={`w-8 h-8 rounded-full border-2 border-white flex items-center justify-center ${c.badge}`}>
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={c.icon} />
                      </svg>
                    </span>
                    <span className="text-white font-bold italic tracking-wide text-lg">{t(`${k}.${side}.label`)}</span>
                  </div>
                  <div className="text-end">
                    <p className={`${c.soft} text-[10px] uppercase tracking-widest font-bold`}>{t('predictedOutcome')}</p>
                    <p className="text-white font-black text-xl">{t(`${k}.${side}.outcome`)}</p>
                  </div>
                </div>

                <div className="p-6 flex-grow">
                  <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest mb-4 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${c.dot}`}></span>
                    {t(`${k}.${side}.sublabel`)}
                  </p>
                  <div className="space-y-4">
                    {items.map((item, idx) => (
                      <div
                        key={idx}
                        className={`p-4 bg-gray-50 rounded-lg border-s-4 ${c.border} ${c.hover} hover:shadow-md transition-all duration-200 cursor-default`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <p className={`text-[10px] ${c.source} font-black uppercase tracking-tighter`}>{item.source}</p>
                          <p className="text-[10px] text-gray-500 font-bold">{formatDate(item.date)}</p>
                        </div>
                        <p className="text-sm font-bold text-gray-900 leading-snug" dir="auto">{t(`${k}.${side}.items.${idx}.headline`)}</p>
                        <div className={`mt-3 p-3 ${c.header} rounded-md text-white text-xs shadow-inner`}>
                          <p className={`${c.soft} text-[9px] font-black uppercase tracking-widest mb-1`}>{t('quote')}</p>
                          <p className="italic leading-relaxed">&quot;<bdi>{t(`${k}.${side}.items.${idx}.quote`)}</bdi>&quot;</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer info */}
        <div className="mt-12 text-center text-[10px] text-gray-500 uppercase tracking-[0.2em] font-bold">
          {t('footer')}
        </div>
      </div>

      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.6s ease-out forwards;
        }
      `}</style>
    </div>
  )
}

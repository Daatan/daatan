'use client'

import React, { useState } from 'react'
import { notFound } from 'next/navigation'
import { useCapabilities } from '@/components/CapabilitiesProvider'
import { analyses } from './data'

export default function RetroanalysisPage() {
  const { selfHosted } = useCapabilities()
  const [activeAnalysisId, setActiveAnalysisId] = useState(analyses[0].id)
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)

  // SaaS-only marketing archive — not part of the self-hosted edition.
  if (selfHosted) notFound()

  const activeAnalysis = analyses.find(a => a.id === activeAnalysisId) || analyses[0]

  const getNavLabel = (id: string) => {
    switch (id) {
      case 'maduro-extraction': return 'Venezuela 2026'
      case 'trump-wars': return 'War Watch 2025'
      case 'energy-volatility-2026': return 'Energy 2026'
      default: return id
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f7fa] text-gray-800 font-sans">
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
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {getNavLabel(analysis.id)}
            </button>
          ))}
        </div>

        {/* Header */}
        <div className="text-center mb-8 animate-fadeIn">
          <span className="inline-block px-4 py-1 bg-gray-900 text-white text-[10px] tracking-widest font-bold rounded-full mb-4 uppercase">
            {activeAnalysis.tag}
          </span>
          <h1 className="text-3xl md:text-5xl font-extrabold text-gray-900 mb-4 tracking-tight leading-tight">
            {activeAnalysis.title}
          </h1>
          <p className="text-gray-500 text-sm md:text-base max-w-2xl mx-auto leading-relaxed">
            {activeAnalysis.description}
          </p>
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
          {/* Left Column */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
            <div className={`bg-teal-600 p-5 flex justify-between items-center`}>
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center bg-teal-700/30">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <span className="text-white font-bold italic tracking-wide text-lg">{activeAnalysis.leftColumn.label}</span>
              </div>
              <div className="text-right">
                <p className="text-teal-100 text-[10px] uppercase tracking-widest font-bold">Predicted Outcome</p>
                <p className="text-white font-black text-xl">{activeAnalysis.leftColumn.outcome}</p>
              </div>
            </div>
            
            <div className="p-6 flex-grow">
              <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                {activeAnalysis.leftColumn.sublabel}
              </p>
              <div className="space-y-4">
                {activeAnalysis.leftColumn.items.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-4 bg-gray-50 rounded-lg border-l-4 border-teal-600 hover:bg-teal-50 hover:shadow-md transition-all duration-200 cursor-default"
                    onMouseEnter={() => setHoveredItem(`left-${idx}`)}
                    onMouseLeave={() => setHoveredItem(null)}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <p className="text-[10px] text-teal-700 font-black uppercase tracking-tighter">{item.source}</p>
                      <p className="text-[10px] text-gray-400 font-bold">{item.date}</p>
                    </div>
                    <p className="text-sm font-bold text-gray-900 leading-snug">{item.headline}</p>
                    {item.quote && (
                      <div className="mt-3 p-3 bg-teal-600 rounded-md text-white text-xs shadow-inner">
                        <p className="text-teal-100 text-[9px] font-black uppercase tracking-widest mb-1">EXACT QUOTE</p>
                        <p className="italic leading-relaxed">&quot;{item.quote}&quot;</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
            <div className={`bg-rose-600 p-5 flex justify-between items-center`}>
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center bg-rose-700/30">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </span>
                <span className="text-white font-bold italic tracking-wide text-lg">{activeAnalysis.rightColumn.label}</span>
              </div>
              <div className="text-right">
                <p className="text-rose-100 text-[10px] uppercase tracking-widest font-bold">Predicted Outcome</p>
                <p className="text-white font-black text-xl">{activeAnalysis.rightColumn.outcome}</p>
              </div>
            </div>
            
            <div className="p-6 flex-grow">
              <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                {activeAnalysis.rightColumn.sublabel}
              </p>
              <div className="space-y-4">
                {activeAnalysis.rightColumn.items.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-4 bg-gray-50 rounded-lg border-l-4 border-rose-600 hover:bg-rose-50 hover:shadow-md transition-all duration-200 cursor-default"
                    onMouseEnter={() => setHoveredItem(`right-${idx}`)}
                    onMouseLeave={() => setHoveredItem(null)}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <p className="text-[10px] text-rose-700 font-black uppercase tracking-tighter">{item.source}</p>
                      <p className="text-[10px] text-gray-400 font-bold">{item.date}</p>
                    </div>
                    <p className="text-sm font-bold text-gray-900 leading-snug">{item.headline}</p>
                    {item.quote && (
                      <div className="mt-3 p-3 bg-rose-600 rounded-md text-white text-xs shadow-inner">
                        <p className="text-rose-100 text-[9px] font-black uppercase tracking-widest mb-1">EXACT QUOTE</p>
                        <p className="italic leading-relaxed">&quot;{item.quote}&quot;</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Detailed Analysis Section */}
        {activeAnalysis.detailedAnalysis && (
          <div className="mb-12 space-y-12">
            <div className="text-center">
              <h2 className="text-2xl font-black text-gray-900 uppercase tracking-tighter">
                Detailed Analysis of the Debate
              </h2>
              <div className="w-24 h-1 bg-gray-900 mx-auto mt-4"></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
              {activeAnalysis.detailedAnalysis.map((section, idx) => (
                <div key={idx} className={idx === 2 ? 'md:col-span-2 max-w-3xl mx-auto text-center' : ''}>
                  <h3 className="text-xl font-extrabold text-gray-900 mb-6 flex items-center gap-3 justify-center md:justify-start">
                    <span className="flex-shrink-0 w-8 h-8 rounded bg-gray-900 text-white flex items-center justify-center text-sm">
                      {idx + 1}
                    </span>
                    {section.title}
                  </h3>
                  <div className="space-y-4">
                    {section.content.map((p, pIdx) => (
                      <p key={pIdx} className="text-gray-600 leading-relaxed text-sm md:text-base">
                        {p}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Citations Section */}
        {activeAnalysis.citations && (activeAnalysis.citations.length > 0) && (
          <div className="mt-12 bg-white rounded-xl shadow-sm border border-gray-200 p-6 md:p-8">
            <h2 className="text-lg font-black text-gray-900 uppercase tracking-widest mb-6 border-b pb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              Works Cited
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
              {activeAnalysis.citations.map((citation, idx) => {
                // Handle different citation formats (with or without URL)
                const text = citation.includes('http') ? citation.split('http')[0].trim().replace(/,$/, '') : citation;
                const url = citation.includes('http') ? `http${citation.split('http')[1]}` : null;
                
                return (
                  <div key={idx} className="text-[11px] leading-relaxed text-gray-600 hover:text-gray-900 transition-colors">
                    <span className="text-gray-400 font-mono mr-2">[{String(idx + 1).padStart(2, '0')}]</span>
                    {text}
                    {url && (
                      <a 
                        href={url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="ml-1 text-teal-600 hover:underline break-all inline-block"
                      >
                        [Link]
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer info */}
        <div className="mt-12 text-center text-[10px] text-gray-400 uppercase tracking-[0.2em] font-bold">
          DAATAN Retro-Analysis Archive &copy; 2026
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

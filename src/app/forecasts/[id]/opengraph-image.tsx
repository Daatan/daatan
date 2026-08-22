import { ImageResponse } from 'next/og'
import { prisma } from '@/lib/prisma'
import { getAppUrl } from '@/lib/branding'

export const runtime = 'nodejs'

export const alt = 'DAATAN Forecast'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const truncate = (text: string, max = 130) =>
  text.length > max ? text.slice(0, max).trimEnd() + '…' : text

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const statusLabel = (status: string) => {
  if (status === 'ACTIVE') return { label: 'ACTIVE', color: '#22C55E' }
  if (status === 'RESOLVED_CORRECT') return { label: 'RESOLVED ✓', color: '#60A5FA' }
  if (status === 'RESOLVED_INCORRECT') return { label: 'RESOLVED ✗', color: '#F87171' }
  return { label: status.replace(/_/g, ' '), color: '#FBBF24' }
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id: idOrSlug } = await params

  const prediction = await prisma.prediction.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    select: {
      claimText: true,
      status: true,
      resolveByDatetime: true,
      confidence: true,
      _count: { select: { commitments: true } },
    },
  })

  if (!prediction) return new Response('Not Found', { status: 404 })

  const status = statusLabel(prediction.status)
  const resolveDate = formatDate(prediction.resolveByDatetime.toISOString())
  const probability = prediction.confidence != null ? `${prediction.confidence}%` : '—'
  const hasProbability = prediction.confidence != null
  const probColor = hasProbability
    ? prediction.confidence! >= 60 ? '#16A34A' : prediction.confidence! >= 40 ? '#B45309' : '#DC2626'
    : '#4A7A9B'
  const claimFontSize = prediction.claimText.length > 90 ? '34px' : prediction.claimText.length > 60 ? '40px' : '46px'

  return new ImageResponse(
    (
      <div style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#B8D4E8',
        backgroundImage: 'linear-gradient(160deg, #C8DEED 0%, #98BDD6 100%)',
        fontFamily: 'sans-serif',
        overflow: 'hidden',
      }}>
        {/* Decorative security circles — light texture */}
        <div style={{ position: 'absolute', top: '-120px', left: '280px', width: '480px', height: '480px', borderRadius: '50%', border: '60px solid rgba(255,255,255,0.07)', display: 'flex' }} />
        <div style={{ position: 'absolute', top: '-60px', left: '200px', width: '320px', height: '320px', borderRadius: '50%', border: '40px solid rgba(255,255,255,0.05)', display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: '-100px', right: '80px', width: '400px', height: '400px', borderRadius: '50%', border: '50px solid rgba(13,42,69,0.07)', display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: '20px', right: '280px', width: '220px', height: '220px', borderRadius: '50%', border: '28px solid rgba(13,42,69,0.05)', display: 'flex' }} />

        {/* Header strip */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#0D2A45',
          padding: '0 52px',
          height: '76px',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '30px', height: '30px', backgroundColor: '#2F6BFF', borderRadius: '6px' }} />
            <span style={{ fontSize: '24px', fontWeight: 'bold', color: '#ffffff', letterSpacing: '0.06em' }}>DAATAN</span>
            <span style={{ fontSize: '12px', color: '#5A8AAC', marginLeft: '10px', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Prediction Card</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: status.color }} />
            <span style={{ fontSize: '14px', fontWeight: 'bold', color: status.color, letterSpacing: '0.1em' }}>{status.label}</span>
          </div>
        </div>

        {/* Main body */}
        <div style={{ display: 'flex', flex: 1 }}>

          {/* Left panel — probability (ID number area) */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '300px',
            flexShrink: 0,
            borderRight: '1px solid rgba(13,42,69,0.18)',
            backgroundColor: 'rgba(13,42,69,0.08)',
            gap: '10px',
          }}>
            <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#2A5A7C', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              AI Probability
            </span>
            <span style={{ fontSize: '100px', fontWeight: 'bold', color: probColor, lineHeight: 1, letterSpacing: '-0.02em' }}>
              {probability}
            </span>
            {hasProbability && (
              <span style={{ fontSize: '10px', color: '#4A7A9B', textAlign: 'center', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                TruthMachine Oracle
              </span>
            )}
          </div>

          {/* Right panel — claim + fields */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            padding: '36px 52px',
            justifyContent: 'space-between',
          }}>
            {/* Forecast field */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#2A5A7C', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                Forecast Question
              </span>
              <div style={{
                fontSize: claimFontSize,
                fontWeight: 'bold',
                color: '#0A1E32',
                lineHeight: 1.3,
              }}>
                {truncate(prediction.claimText)}
              </div>
            </div>

            {/* Metadata row */}
            <div style={{ display: 'flex', gap: '48px', borderTop: '1px solid rgba(13,42,69,0.15)', paddingTop: '20px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#2A5A7C', letterSpacing: '0.14em', textTransform: 'uppercase' }}>Resolves</span>
                <span style={{ fontSize: '22px', fontWeight: 'bold', color: '#0A1E32' }}>{resolveDate}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#2A5A7C', letterSpacing: '0.14em', textTransform: 'uppercase' }}>Forecasters</span>
                <span style={{ fontSize: '22px', fontWeight: 'bold', color: '#0A1E32' }}>{prediction._count.commitments}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer strip — MRZ-style */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#0D2A45',
          padding: '0 52px',
          height: '54px',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: '13px', color: '#5A8AAC', letterSpacing: '0.04em' }}>
            {new URL(getAppUrl()).hostname}
          </span>
          <span style={{ fontSize: '11px', color: '#2A4A62', letterSpacing: '0.18em' }}>
            {'DAATAN<<FORECAST<<PREDICTION<<MARKET<<<<<<<<'}
          </span>
        </div>
      </div>
    ),
    { ...size }
  )
}

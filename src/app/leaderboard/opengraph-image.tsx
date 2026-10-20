import { ImageResponse } from 'next/og'
import { prisma } from '@/lib/prisma'


export const alt = 'DAATAN Leaderboard — Top Forecasters'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  const forecasterCount = await prisma.user.count({ where: { isBot: false } })

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          backgroundColor: '#0B1F33',
          backgroundImage: 'linear-gradient(135deg, #0B1F33 0%, #0E2D4A 100%)',
          padding: '80px',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '48px' }}>
          <div style={{ width: '44px', height: '44px', backgroundColor: '#2F6BFF', borderRadius: '10px', marginRight: '16px' }} />
          <span style={{ fontSize: '36px', fontWeight: 'bold', color: '#ffffff', letterSpacing: '-0.02em' }}>DAATAN</span>
        </div>

        <div style={{ fontSize: '80px', fontWeight: 'bold', color: '#ffffff', lineHeight: 1.05, marginBottom: '28px', display: 'flex' }}>
          Leaderboard
        </div>

        <div style={{ fontSize: '32px', color: '#7A9CC0', lineHeight: 1.3, marginBottom: '64px', display: 'flex' }}>
          Rankings by Brier score, ELO, peer score, and reputation.
        </div>

        <div style={{ display: 'flex', gap: '64px' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '56px', fontWeight: 'bold', color: '#2F6BFF' }}>{forecasterCount}</span>
            <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#7A9CC0', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Forecasters
            </span>
          </div>
          <div style={{ width: '1px', backgroundColor: 'rgba(255,255,255,0.1)' }} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '56px', fontWeight: 'bold', color: '#2EC4B6' }}>8+</span>
            <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#7A9CC0', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Scoring Systems
            </span>
          </div>
        </div>
      </div>
    ),
    { ...size }
  )
}

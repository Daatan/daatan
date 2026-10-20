import { ImageResponse } from 'next/og'


export const alt = 'How DAATAN Works'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
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
          How It Works
        </div>

        <div style={{ fontSize: '32px', color: '#7A9CC0', lineHeight: 1.3, marginBottom: '64px', display: 'flex' }}>
          Make forecasts. Stake reputation. Track your accuracy over time.
        </div>

        <div style={{ display: 'flex', gap: '48px' }}>
          {['Brier Scores', 'ELO Ratings', 'Peer Scoring'].map((label) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#2F6BFF' }} />
              <span style={{ fontSize: '22px', fontWeight: 'bold', color: '#B2BED0', letterSpacing: '0.02em' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size }
  )
}

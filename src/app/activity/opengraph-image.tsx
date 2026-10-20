import { ImageResponse } from 'next/og'


export const alt = 'DAATAN Activity Feed'
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
          Activity Feed
        </div>

        <div style={{ fontSize: '32px', color: '#7A9CC0', lineHeight: 1.3, display: 'flex' }}>
          Live stream of forecasts, commitments, and resolutions.
        </div>
      </div>
    ),
    { ...size }
  )
}

import { ImageResponse } from 'next/og'


export const alt = 'DAATAN — Measurable Forecasts'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
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
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '48px' }}>
          <div style={{ width: '52px', height: '52px', backgroundColor: '#2563eb', borderRadius: '10px', marginRight: '18px' }} />
          <span style={{ fontSize: '42px', fontWeight: 'bold', color: '#ffffff', letterSpacing: '-0.02em' }}>
            DAATAN
          </span>
        </div>

        <div
          style={{
            fontSize: '72px',
            fontWeight: 'bold',
            color: '#ffffff',
            lineHeight: 1.1,
            marginBottom: '32px',
            display: 'flex',
            maxWidth: '960px',
          }}
        >
          Turn opinions into measurable forecasts.
        </div>

        <div
          style={{
            fontSize: '30px',
            color: '#7A9CC0',
            lineHeight: 1.4,
            display: 'flex',
            maxWidth: '860px',
          }}
        >
          Track forecasts, measure accuracy over time, and build a public track record.
        </div>
      </div>
    ),
    { ...size }
  )
}

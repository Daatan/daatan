import { ImageResponse } from 'next/og'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

export const alt = 'DAATAN User Profile'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const user = await prisma.user.findFirst({
    where: { OR: [{ id }, { username: id }] },
    select: {
      name: true,
      username: true,
      image: true,
      eloRating: true,
      _count: { select: { predictions: true, commitments: true } },
    },
  })

  if (!user) return new Response('Not Found', { status: 404 })

  const initial = (user.name ?? '?').charAt(0).toUpperCase()

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#0B1F33',
          backgroundImage: 'linear-gradient(135deg, #0B1F33 0%, #0E2D4A 100%)',
          padding: '60px 72px',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '48px' }}>
          <div style={{ width: '36px', height: '36px', backgroundColor: '#2F6BFF', borderRadius: '8px', marginRight: '12px' }} />
          <span style={{ fontSize: '28px', fontWeight: 'bold', color: '#ffffff', letterSpacing: '-0.02em' }}>DAATAN</span>
        </div>

        {/* Profile row */}
        <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
          {/* Avatar */}
          {user.image ? (
            <img
              src={user.image}
              style={{ width: '160px', height: '160px', borderRadius: '50%', marginRight: '48px', border: '4px solid #1C3A5A' }}
              alt=""
            />
          ) : (
            <div style={{
              width: '160px', height: '160px', borderRadius: '50%',
              backgroundColor: '#1C3A5A', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: '64px', fontWeight: 'bold',
              color: '#2F6BFF', marginRight: '48px', border: '4px solid #2F6BFF',
            }}>{initial}</div>
          )}

          {/* Name + stats */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <span style={{ fontSize: '64px', fontWeight: 'bold', color: '#ffffff', lineHeight: 1, marginBottom: '8px' }}>
              {user.name}
            </span>
            <span style={{ fontSize: '28px', color: '#7A9CC0', marginBottom: '40px' }}>
              @{user.username ?? 'anonymous'}
            </span>

            {/* Stats */}
            <div style={{ display: 'flex', gap: '48px' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#7A9CC0', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                  ELO rating
                </span>
                <span style={{ fontSize: '48px', fontWeight: 'bold', color: '#2F6BFF' }}>
                  {Math.round(user.eloRating)}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#7A9CC0', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                  Commitments
                </span>
                <span style={{ fontSize: '48px', fontWeight: 'bold', color: '#ffffff' }}>
                  {user._count.commitments}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#7A9CC0', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                  Forecasts
                </span>
                <span style={{ fontSize: '48px', fontWeight: 'bold', color: '#ffffff' }}>
                  {user._count.predictions}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size }
  )
}

import { useMemo, useState, useCallback, useRef } from 'react'

interface SpeedometerProps {
  percentage?: number // Market average (default needle)
  userPercentage?: number // Thick interactive needle
  aiPercentage?: number // AI mark
  /** Lower bound of AI confidence interval (0–100). Renders a translucent band when paired with aiCiHigh. */
  aiCiLow?: number
  /** Upper bound of AI confidence interval (0–100). */
  aiCiHigh?: number
  label?: string
  /** Small caption rendered under the central percentage (e.g. "You"). Omit to render nothing. */
  centerLabel?: string
  color?: 'green' | 'red'
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  onUserPercentageChange?: (pct: number) => void
}

export default function Speedometer({
  percentage = 50,
  userPercentage,
  aiPercentage,
  aiCiLow,
  aiCiHigh,
  label,
  centerLabel,
  color = 'green',
  size = 'md',
  onUserPercentageChange,
}: SpeedometerProps) {
  const safeMarketPct = isNaN(percentage) ? 50 : Math.min(100, Math.max(0, percentage))

  const sizes = {
    xs: { width: 64, height: 40, strokeWidth: 4, fontSize: '10px', needleBase: 3.5, pivotRadius: 2.5, hitRadius: 9 },
    sm: { width: 120, height: 72, strokeWidth: 5, fontSize: '12px', needleBase: 5, pivotRadius: 3.5, hitRadius: 14 },
    md: { width: 160, height: 96, strokeWidth: 7, fontSize: '15px', needleBase: 6, pivotRadius: 4.5, hitRadius: 18 },
    lg: { width: 220, height: 132, strokeWidth: 9, fontSize: '18px', needleBase: 8, pivotRadius: 6, hitRadius: 24 },
    xl: { width: 280, height: 168, strokeWidth: 11, fontSize: '24px', needleBase: 10, pivotRadius: 7.5, hitRadius: 30 },
  }

  const { width, height, strokeWidth, fontSize, needleBase, pivotRadius, hitRadius } = sizes[size]

  const [isDragging, setIsDragging] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)

  const bottomPad = strokeWidth + pivotRadius + 4
  const topPad = strokeWidth + 4
  const radius = Math.min(width / 2 - strokeWidth - 4, height - topPad - bottomPad)
  const center = { x: width / 2, y: height - bottomPad }

  const getTickEnds = (pct: number) => {
    const angleDeg = 180 + (pct / 100) * 180
    const angleRad = (angleDeg * Math.PI) / 180
    const half = strokeWidth / 2 + 2
    return {
      x1: center.x + (radius - half) * Math.cos(angleRad),
      y1: center.y + (radius - half) * Math.sin(angleRad),
      x2: center.x + (radius + half) * Math.cos(angleRad),
      y2: center.y + (radius + half) * Math.sin(angleRad),
    }
  }

  const getTipPoint = (pct: number, length: number) => {
    const angleDeg = 180 + (pct / 100) * 180
    const angleRad = (angleDeg * Math.PI) / 180
    return {
      x: center.x + length * Math.cos(angleRad),
      y: center.y + length * Math.sin(angleRad),
    }
  }

  const getNeedlePath = (pct: number, baseWidth: number, isThick: boolean = false) => {
    const angleDeg = 180 + (pct / 100) * 180
    const length = isThick ? radius - 4 : radius - 2

    const perpAngleLeft = ((angleDeg + 90) * Math.PI) / 180
    const perpAngleRight = ((angleDeg - 90) * Math.PI) / 180

    const bLeft = {
      x: center.x + (baseWidth / 2) * Math.cos(perpAngleLeft),
      y: center.y + (baseWidth / 2) * Math.sin(perpAngleLeft),
    }
    const bRight = {
      x: center.x + (baseWidth / 2) * Math.cos(perpAngleRight),
      y: center.y + (baseWidth / 2) * Math.sin(perpAngleRight),
    }
    const tip = getTipPoint(pct, length)

    return `M ${bLeft.x} ${bLeft.y} L ${tip.x} ${tip.y} L ${bRight.x} ${bRight.y} Z`
  }

  const theme = useMemo(() => {
    return {
      greenGradientId: `arc-gradient-green-${size}`,
      redGradientId: `arc-gradient-red-${size}`,
      shadowId: `arc-shadow-${size}`,
      pivotGradientId: `pivot-gradient-${size}`,
      greenStart: 'hsl(142, 70%, 55%)',
      greenMiddle: 'hsl(142, 72%, 45%)',
      greenEnd: 'hsl(142, 76%, 36%)',
      redStart: 'hsl(0, 70%, 65%)',
      redMiddle: 'hsl(0, 72%, 55%)',
      redEnd: 'hsl(0, 84%, 44%)',
      grayBackground: '#1C3A5A',
      needleMarket: '#A0AEC0',
      needleUser: '#3B82F6', // Blue-500
      needleAI: '#FBBF24', // Amber-400
      text: '#E6E9EF',
    }
  }, [size])

  // Reads from svgRef rather than e.currentTarget so the calculation is
  // correct regardless of which child element (the drag thumb) received
  // the pointer event.
  const getPctFromPoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return 50
    const rect = svg.getBoundingClientRect()
    const scaleX = width / rect.width
    const scaleY = height / rect.height
    const mx = (clientX - rect.left) * scaleX
    const my = (clientY - rect.top) * scaleY
    const dx = mx - center.x
    const dy = my - center.y
    let deg = Math.atan2(dy, dx) * 180 / Math.PI
    if (deg < 0) deg += 360
    // Arc: 180° (left, 0%) → 270° (top, 50%) → 360° (right, 100%)
    // Angles 0..90 are upper-right → clamp to 100; 90..180 are upper-left → clamp to 0
    if (deg < 90) return 100
    if (deg < 180) return 0
    return (deg - 180) / 180 * 100
  }, [center.x, center.y, width, height])

  // Pointer handlers live on the small drag thumb (not the whole SVG), so a
  // touch anywhere else on the gauge — or on the page around it — scrolls
  // normally. Only grabbing the thumb itself enters drag mode.
  const handlePointerDown = useCallback((e: React.PointerEvent<SVGCircleElement>) => {
    if (!onUserPercentageChange || userPercentage === undefined) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId)
    setIsDragging(true)
    onUserPercentageChange(getPctFromPoint(e.clientX, e.clientY))
  }, [onUserPercentageChange, userPercentage, getPctFromPoint])

  const handlePointerMove = useCallback((e: React.PointerEvent<SVGCircleElement>) => {
    if (!isDragging || !onUserPercentageChange) return
    onUserPercentageChange(getPctFromPoint(e.clientX, e.clientY))
  }, [isDragging, onUserPercentageChange, getPctFromPoint])

  const handlePointerUp = useCallback((e: React.PointerEvent<SVGCircleElement>) => {
    if (!isDragging) return
    ;(e.currentTarget as SVGCircleElement).releasePointerCapture(e.pointerId)
    setIsDragging(false)
  }, [isDragging])

  // Tap-to-jump on the arc itself. Deliberately a `click` handler, not
  // pointerdown/move: browsers only synthesize `click` for a touch that
  // stayed in place, and suppress it once the same touch has scrolled the
  // page past their own pan threshold. That gives free tap-vs-scroll
  // disambiguation without custom gesture math, and this element keeps the
  // default touch-action so scrolling over the arc still works.
  const handleArcClick = useCallback((e: React.MouseEvent<SVGPathElement>) => {
    if (!onUserPercentageChange || userPercentage === undefined) return
    onUserPercentageChange(getPctFromPoint(e.clientX, e.clientY))
  }, [onUserPercentageChange, userPercentage, getPctFromPoint])

  const backgroundArc = createArcPath(center, radius, 180, 360)
  const redArc = createArcPath(center, radius, 180, 270) // Left half (NO side)
  const greenArc = createArcPath(center, radius, 270, 360) // Right half (YES side)

  const isDraggable = !!onUserPercentageChange && userPercentage !== undefined

  return (
    <div className="flex flex-col items-center">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
      >
        <defs>
          <linearGradient id={theme.greenGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={theme.greenStart} />
            <stop offset="100%" stopColor={theme.greenMiddle} />
          </linearGradient>
          <linearGradient id={theme.redGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={theme.redMiddle} />
            <stop offset="100%" stopColor={theme.redEnd} />
          </linearGradient>
          <filter id={theme.shadowId} x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="1" stdDeviation="0.5" floodOpacity="0.25" />
          </filter>
        </defs>

        {/* Background track */}
        <path d={backgroundArc} fill="none" stroke={theme.grayBackground} strokeWidth={strokeWidth} strokeLinecap="round" />

        {/* Arcs */}
        <path d={greenArc} fill="none" stroke={`url(#${theme.greenGradientId})`} strokeWidth={strokeWidth} strokeLinecap="round" />
        <path d={redArc} fill="none" stroke={`url(#${theme.redGradientId})`} strokeWidth={strokeWidth} strokeLinecap="round" />

        {/* Invisible, generously-wide tap target over the arc: click anywhere
            on the gauge to jump the needle there. Left at default touch-action
            (not "none") so a touch that turns into a page scroll never
            reaches this as a click. */}
        {isDraggable && (
          <path
            d={backgroundArc}
            fill="none"
            stroke="transparent"
            strokeWidth={strokeWidth + 24}
            style={{ cursor: 'pointer' }}
            onClick={handleArcClick}
          />
        )}

        {/* AI Confidence Interval band (rendered under ticks so AI tick sits on top).
            Wider than the arc stroke so it shows as a bright amber halo extending
            outside the green/red arc — visibility on saturated colors was poor when
            the band was the same width as the arc (amber washed into green). */}
        {aiCiLow !== undefined && aiCiHigh !== undefined && aiCiHigh > aiCiLow && (() => {
          const ciLo = Math.min(100, Math.max(0, aiCiLow))
          const ciHi = Math.min(100, Math.max(0, aiCiHigh))
          const startDeg = 180 + (ciLo / 100) * 180
          const endDeg = 180 + (ciHi / 100) * 180
          const ciArc = createArcPath(center, radius, startDeg, endDeg)
          const getTick = (deg: number) => {
            const rad = (deg * Math.PI) / 180
            const half = strokeWidth / 2 + 4
            return {
              x1: center.x + (radius - half) * Math.cos(rad),
              y1: center.y + (radius - half) * Math.sin(rad),
              x2: center.x + (radius + half) * Math.cos(rad),
              y2: center.y + (radius + half) * Math.sin(rad),
            }
          }
          const lowTick = getTick(startDeg)
          const highTick = getTick(endDeg)
          return (
            <g>
              <path
                data-testid="ai-ci-band"
                d={ciArc}
                fill="none"
                stroke={theme.needleAI}
                strokeWidth={strokeWidth + 4}
                strokeLinecap="butt"
                opacity={0.6}
              />
              <line
                data-testid="ai-ci-tick-low"
                x1={lowTick.x1} y1={lowTick.y1} x2={lowTick.x2} y2={lowTick.y2}
                stroke={theme.needleAI}
                strokeWidth={1.5}
                strokeLinecap="round"
                opacity={0.9}
              />
              <line
                data-testid="ai-ci-tick-high"
                x1={highTick.x1} y1={highTick.y1} x2={highTick.x2} y2={highTick.y2}
                stroke={theme.needleAI}
                strokeWidth={1.5}
                strokeLinecap="round"
                opacity={0.9}
              />
            </g>
          )
        })()}

        {/* Market Mark (tick) */}
        {(() => {
          const { x1, y1, x2, y2 } = getTickEnds(safeMarketPct)
          return (
            <line
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={theme.needleMarket}
              strokeWidth={2}
              strokeLinecap="round"
              className="transition-all duration-700 ease-in-out"
            />
          )
        })()}

        {/* AI Mark (tick) */}
        {aiPercentage !== undefined && (() => {
          const { x1, y1, x2, y2 } = getTickEnds(aiPercentage)
          return (
            <line
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={theme.needleAI}
              strokeWidth={2.5}
              strokeLinecap="round"
              filter={`url(#${theme.shadowId})`}
            />
          )
        })()}

        {/* User Needle (Thick) */}
        {userPercentage !== undefined && (
          <path
            d={getNeedlePath(userPercentage, needleBase * 2, true)}
            fill={theme.needleUser}
            filter={`url(#${theme.shadowId})`}
            className="transition-all duration-150 ease-out"
          />
        )}

        {/* Drag thumb (User Needle only): the only element that captures
            pointer events, so touch anywhere else on the gauge — or on the
            page around it — scrolls normally instead of moving the needle.
            touch-none is critical on iOS Safari here: without it the
            browser can still claim the gesture as a page scroll after a few
            pixels and stop routing pointermove to this element. */}
        {isDraggable && userPercentage !== undefined && (() => {
          const tip = getTipPoint(userPercentage, radius - 4)
          return (
            <circle
              cx={tip.x}
              cy={tip.y}
              r={hitRadius}
              fill="transparent"
              className="touch-none select-none"
              style={{ cursor: isDragging ? 'grabbing' : 'grab', WebkitTouchCallout: 'none' }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
          )
        })()}

        {/* Pivot */}
        <circle cx={center.x} cy={center.y} r={pivotRadius} fill={theme.grayBackground} stroke={theme.needleMarket} strokeWidth="1" />

        {/* Display Text */}
        <text
          x={center.x}
          y={center.y - radius * 0.42}
          textAnchor="middle"
          dominantBaseline="middle"
          className="font-black"
          style={{ fontSize, fill: theme.text }}
        >
          {userPercentage !== undefined ? Math.round(userPercentage) : Math.round(safeMarketPct)}%
        </text>

        {/* Optional caption under the central number (e.g. "You") */}
        {centerLabel && (
          <text
            x={center.x}
            y={center.y - radius * 0.42 + parseInt(fontSize, 10) * 0.85}
            textAnchor="middle"
            dominantBaseline="middle"
            className="font-bold uppercase"
            style={{ fontSize: `${Math.round(parseInt(fontSize, 10) * 0.42)}px`, fill: theme.needleUser, letterSpacing: '0.08em' }}
          >
            {centerLabel}
          </text>
        )}
      </svg>

      {label && (
        <span className="mt-1 text-[10px] font-bold uppercase tracking-widest text-text-secondary text-center px-4">
          {label}
        </span>
      )}
    </div>
  )
}

function createArcPath(center: { x: number; y: number }, radius: number, startAngle: number, endAngle: number): string {
  if (Math.abs(startAngle - endAngle) < 0.5) return ''
  const start = polarToCartesian(center.x, center.y, radius, startAngle)
  const end = polarToCartesian(center.x, center.y, radius, endAngle)
  const sweepFlag = endAngle > startAngle ? 1 : 0
  return ['M', start.x, start.y, 'A', radius, radius, 0, 0, sweepFlag, end.x, end.y].join(' ')
}

function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number): { x: number; y: number } {
  const angleInRadians = (angleInDegrees * Math.PI) / 180
  return { x: centerX + radius * Math.cos(angleInRadians), y: centerY + radius * Math.sin(angleInRadians) }
}

const CX = 376
const CY = 280

function polar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)]
}

function ticks(from: number, to: number, step: number, offset = 0): string {
  const parts: string[] = []
  for (let d = offset; d < 360; d += step) {
    const [x1, y1] = polar(from, d)
    const [x2, y2] = polar(to, d)
    parts.push(`M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`)
  }
  return parts.join(' ')
}

// Open predictions on the outer ring, resolved ones inside it. Decorative only —
// it illustrates the idea and must not be read as real data.
const OPEN = [[300.8, 73.3], [432.9, 67.5], [544.5, 138.6], [592.7, 241.8], [575.4, 373], [469, 479.4], [337.8, 496.7], [207.5, 421.4]]
const RIGHT = [[461, 132.8], [535.7, 338.1], [302.1, 191.9], [475.6, 222.5], [376, 395]]
const WRONG = [[317.9, 120.3], [475.6, 337.5]]
const NOISE = [[319.6, 259.5], [432.4, 259.5], [365.6, 339.1]]

export default function RadarArt() {
  return (
    <svg aria-hidden="true" viewBox="0 0 612 560" fill="none" className="block h-full w-full">
      <path d="M142 280H610 M376 46V514" stroke="#3F7DC6" strokeOpacity="0.18" />
      {[[60, 0.55], [115, 0.4], [170, 0.28], [220, 0.45]].map(([r, o]) => (
        <circle key={r} cx={CX} cy={CY} r={r} stroke="#3F7DC6" strokeOpacity={o} />
      ))}
      <path d={ticks(224, 230, 6)} stroke="#3F7DC6" strokeOpacity="0.32" />
      <path d={ticks(220, 232, 30)} stroke="#3F7DC6" strokeOpacity="0.6" />
      <path d="M304.2 434.1 A170 170 0 0 1 211.8 324" stroke="#46B19B" strokeWidth="5" strokeLinecap="round" />
      <path d="M376 280L478.5 177.5" stroke="#7AA8DF" strokeWidth="3" strokeLinecap="round" />
      {OPEN.map(([x, y]) => (
        <circle key={`o${x}`} cx={x} cy={y} r="4.5" fill="#001020" stroke="#7AA8DF" strokeWidth="1.5" />
      ))}
      {RIGHT.map(([x, y]) => (
        <circle key={`r${x}`} cx={x} cy={y} r="5" fill="#46B19B" />
      ))}
      {WRONG.map(([x, y]) => (
        <circle key={`w${x}`} cx={x} cy={y} r="4.5" fill="#001020" stroke="#C75B5B" strokeWidth="2" />
      ))}
      {NOISE.map(([x, y]) => (
        <circle key={`n${x}`} cx={x} cy={y} r="3.5" fill="#7AA8DF" />
      ))}
      <path d="M195.8 153.8L138 132 M206 280L138 282 M245.8 389.3L138 452" stroke="#7AA8DF" strokeOpacity="0.55" />
      <circle cx="195.8" cy="153.8" r="11" stroke="#7AA8DF" strokeOpacity="0.45" />
      <circle cx="195.8" cy="153.8" r="5.5" fill="#001020" stroke="#7AA8DF" strokeWidth="1.5" />
      <circle cx="206" cy="280" r="11" stroke="#46B19B" strokeOpacity="0.45" />
      <circle cx="206" cy="280" r="6" fill="#46B19B" />
      <circle cx="245.8" cy="389.3" r="11" stroke="#46B19B" strokeOpacity="0.45" />
      <circle cx="245.8" cy="389.3" r="6" fill="#46B19B" />
      <circle cx={CX} cy={CY} r="20" stroke="#3F7DC6" strokeOpacity="0.6" strokeWidth="1.5" />
      <circle cx={CX} cy={CY} r="11" fill="#3F7DC6" />
    </svg>
  )
}

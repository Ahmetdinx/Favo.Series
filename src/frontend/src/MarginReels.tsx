import type { ReactNode } from 'react'
import './margin-reels.css'

// The page margins hold two quiet strips of 35 mm film seen straight on, faded toward the content in the middle
// (Film's counterpart of Books' flat margin bookcases). Frames are empty and nearly the colour of the page. Decorative.
const W = 220
const H = 1000
const STRIP_X = 50
const STRIP_W = 120
const FRAME_H = 92
const GAP = 12
const HOLE = 10

function Reel({ prefix, offset }: { prefix: string; offset: number }) {
  const frames: ReactNode[] = []
  for (let y = -offset; y < H; y += FRAME_H + GAP)
    frames.push(<rect key={y} x={STRIP_X + 18} y={y} width={STRIP_W - 36} height={FRAME_H} rx="2" fill="#2a343a" />)
  const holes: ReactNode[] = []
  for (let y = 4; y < H; y += HOLE * 2) {
    holes.push(<rect key={'l' + y} x={STRIP_X + 5} y={y} width="7" height={HOLE} rx="1.5" fill="#20272a" />)
    holes.push(<rect key={'r' + y} x={STRIP_X + STRIP_W - 12} y={y} width="7" height={HOLE} rx="1.5" fill="#20272a" />)
  }
  return <>
    <defs>
      {/* Visible at the outer edge, gone before the content column. */}
      <linearGradient id={`${prefix}-fade`} x1="0" x2="1">
        <stop offset="0" stopColor="#ffffff" stopOpacity=".55" />
        <stop offset=".6" stopColor="#ffffff" stopOpacity=".3" />
        <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
      <mask id={`${prefix}-mask`}><rect width={W} height={H} fill={`url(#${prefix}-fade)`} /></mask>
    </defs>
    <g mask={`url(#${prefix}-mask)`}>
      <rect x={STRIP_X} y="0" width={STRIP_W} height={H} fill="#0f1214" />
      {frames}
      {holes}
    </g>
  </>
}

export default function MarginReels() {
  return <div className="margin-reels" aria-hidden="true">
    <svg className="margin-reel margin-reel-left" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMinYMid slice"><Reel prefix="mrl" offset={20} /></svg>
    <svg className="margin-reel margin-reel-right" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMinYMid slice"><Reel prefix="mrr" offset={64} /></svg>
  </div>
}

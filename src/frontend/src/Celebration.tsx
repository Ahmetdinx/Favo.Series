import { useEffect, useRef, useState } from 'react'
import { CinemaAvatar, useCommunity } from './Community'
import type { Track } from './Journey'
import './celebration.css'

/**
 * A small card in the corner when the viewer earns a new badge (Books' AchievementCelebration). The last thresholds seen
 * are kept per user in the browser, so a badge is celebrated once, on whichever page it was earned or first seen.
 */
export function Celebration() {
  const { account, me } = useCommunity()
  const userId = account.session?.userId
  const items = me?.achievements
  const previous = useRef<Record<string, number> | null>(null)
  const [earned, setEarned] = useState<Track[]>([])
  useEffect(() => {
    if (!userId || !items?.length) return
    const key = `favo-dizi:celebrations:${userId}`
    if (previous.current === null) {
      try {
        const stored = JSON.parse(localStorage.getItem(key) ?? 'null')
        if (stored && typeof stored === 'object' && !Array.isArray(stored)
          && Object.values(stored).every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) previous.current = stored
      } catch { /* storage is optional */ }
      // First visit on this browser: today's badges are the baseline, nothing is celebrated.
      previous.current ??= Object.fromEntries(items.map(t => [t.kind, t.current?.threshold ?? 0]))
    }
    const baseline = previous.current
    const gained = items.filter(t => (t.current?.threshold ?? 0) > (baseline[t.kind] ?? 0))
    if (gained.length) setEarned(current => [...current.filter(t => !gained.some(g => g.kind === t.kind)), ...gained])
    for (const item of items) baseline[item.kind] = Math.max(baseline[item.kind] ?? 0, item.current?.threshold ?? 0)
    try { localStorage.setItem(key, JSON.stringify(baseline)) } catch { /* keep this session's baseline */ }
  }, [items, userId])
  if (!earned.length) return null
  return <aside className="badge-celebration" aria-label="Yeni rozet">
    <button type="button" className="badge-celebration-close" aria-label="Kutlamayı kapat" onClick={() => setEarned([])}>×</button>
    <span className="badge-celebration-avatar"><CinemaAvatar id={me?.avatarId} /></span>
    <div role="status" aria-live="polite"><small>Yeni rozetin hazır!</small>
      {earned.map(track => <div key={track.kind}><strong>{track.current?.title}</strong>
        <p>{track.next ? `${track.next.title} için ${track.remaining} ${track.kind === 'watching' ? 'film' : 'değerlendirme'} daha.` : 'Bu serideki tüm rozetleri açtın.'}</p></div>)}
    </div>
  </aside>
}

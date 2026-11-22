import { useCallback, useState } from 'react'
import { useCommunity, type Entry } from './Community'
import './watch.css'

const base = import.meta.env.BASE_URL

/** The five watch states, as the Books shelves: three main ones and two quieter ones. */
export const watchStates: [string, string][] = [['watchlist', 'İzleyeceğim'], ['watching', 'İzliyorum'], ['watched', 'İzledim'], ['paused', 'Ara verdim'], ['dropped', 'Yarım bıraktım']]
export const watchLabel = Object.fromEntries(watchStates) as Record<string, string>
export const mainStates = watchStates.slice(0, 3)

type Undo = { previous: Entry | null }

/**
 * One-tap watch changes with a one-time "Geri al", shared by the catalog cards.
 * Entries come from the viewer's profile; changes are kept locally so the cards never flicker while it reloads.
 */
export function useWatchActions() {
  const { me, api } = useCommunity()
  const [local, setLocal] = useState<Record<number, Entry | null>>({})
  const [busy, setBusy] = useState<Record<number, boolean>>({})
  const [undos, setUndos] = useState<Record<number, Undo>>({})
  const [errors, setErrors] = useState<Record<number, string>>({})
  const entries = { ...Object.fromEntries((me?.entries ?? []).map(r => [r.movie.id, r.entry])), ...local } as Record<number, Entry | null>
  const run = useCallback(async (id: number, work: () => Promise<unknown>, after: () => void) => {
    setBusy(b => ({ ...b, [id]: true })); setErrors(e => ({ ...e, [id]: '' }))
    try { await work(); after() }
    catch (e) { setErrors(x => ({ ...x, [id]: (e as Error).message })) }
    finally { setBusy(b => ({ ...b, [id]: false })) }
  }, [])
  async function change(id: number, state: string) {
    const previous = entries[id] ?? null
    // Tapping the chosen state again keeps it; a watched film keeps its scores.
    if (previous?.state === state) return
    await run(id, () => api('/api/series/community/entry/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, scores: state === 'watched' ? previous?.scores ?? null : null }) }),
      () => { setUndos(u => ({ ...u, [id]: { previous } })); setLocal(l => ({ ...l, [id]: { movieId: id, state, scores: state === 'watched' ? previous?.scores ?? null : null, overall: state === 'watched' ? previous?.overall ?? null : null } })) })
  }
  async function undo(id: number) {
    await run(id, () => api('/api/series/community/entry/' + id + '/undo', { method: 'POST' }), () => { const previous = undos[id]?.previous ?? null; setLocal(l => ({ ...l, [id]: previous })); setUndos(u => { const next = { ...u }; delete next[id]; return next }) })
  }
  return { signedIn: !!me, entries, busy, undos, errors, change, undo }
}
export type WatchActions = ReturnType<typeof useWatchActions>

/** Catalog card actions: the three main states, a status line with "Geri al", and a nudge to rate a just-watched film. */
export function CatalogWatchActions({ id, title, actions }: { id: number; title: string; actions: WatchActions }) {
  if (!actions.signedIn) return null
  const entry = actions.entries[id], busy = !!actions.busy[id], undo = actions.undos[id]
  return <div className="catalog-watch" role="group" aria-label={title + ' izleme durumu'}>
    <div className="catalog-watch-buttons">
      {mainStates.map(([key, label]) => <button type="button" key={key} aria-pressed={entry?.state === key} disabled={busy} onClick={() => void actions.change(id, key)}>
        {entry?.state === key && <span aria-hidden="true">✓ </span>}{label}</button>)}
    </div>
    <div className="catalog-watch-feedback">
      <span role="status">{busy ? 'Kaydediliyor…' : undo ? (undo.previous ? 'Durum güncellendi.' : 'Arşivine eklendi.') : entry && !mainStates.some(([k]) => k === entry.state) ? watchLabel[entry.state] : ''}</span>
      {undo && <button type="button" disabled={busy} onClick={() => void actions.undo(id)}>Geri al</button>}
    </div>
    {entry?.state === 'watched' && !entry.scores && undo && <a className="catalog-watch-rate" href={base + 'movie/' + id + '#degerlendir'}>İstersen değerlendir →</a>}
    {actions.errors[id] && <p role="alert" className="catalog-watch-error">{actions.errors[id]}</p>}
  </div>
}

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { CinemaAvatar, ErrorBox, MiniPoster, criteria, useCommunity, useResource, type Film, type FilmRow, type Preference } from './Community'
import FilmHighlights from './FilmHighlights'
import { OnboardingHomeCard } from './Onboarding'
import './home.css'

const base = import.meta.env.BASE_URL

type Activity = { nickname: string; avatarId: string; movie: Film; overall: number | null; updatedAtUtc: string }
type Suggestion = { movie: Film; shelf: string; reasons: string[]; ratingCount: number }
type HomeData = { preferences: Preference; suggestions: Suggestion[]; watching: Activity[]; reviews: Activity[]; catalogNotice: string | null }
const json = (body: unknown): RequestInit => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/**
 * Signed-in home, in the same order as Favo Kitap: what to watch next (preferences, two featured picks,
 * the circle, three recommendation shelves), then the watchlist and films waiting for a rating.
 */
export default function FilmHome() {
  return <div className="film-home">
    <OnboardingHomeCard />
    <Recommendations />
    <FilmHighlights />
    <WatchlistShelf />
    <RatingPrompts />
  </div>
}

function Recommendations() {
  const { api, reload } = useCommunity()
  const [revision, setRevision] = useState(0)
  const result = useResource<HomeData>('/api/series/community/home?r=' + revision)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [hidden, setHidden] = useState<number[]>([])
  const data = result.data
  const items = data?.suggestions.filter(s => !hidden.includes(s.movie.id)) ?? []
  const featured = items.slice(0, 2)

  async function feedback(s: Suggestion, choice: 'interested' | 'dismissed') {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      // Like "İlgimi çekti" in Kitap, interest also puts the film on the watchlist.
      if (choice === 'interested') await api('/api/series/community/entry/' + s.movie.id, { method: 'PUT', ...json({ state: 'watchlist', scores: null }) })
      await api('/api/series/community/feedback/' + s.movie.id, { method: 'PUT', ...json({ choice }) })
      setHidden(h => [...h, s.movie.id])
      setMessage(choice === 'interested' ? `«${s.movie.title}» izleme listene eklendi.` : `«${s.movie.title}» önerilerinden çıkarıldı.`)
      if (choice === 'interested') reload()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const actions = (s: Suggestion, compact = false) => <div className="film-feedback" role="group" aria-label={`${s.movie.title} için geri bildirim`}>
    <button type="button" disabled={busy} title="İlgimi çekti" aria-label="İlgimi çekti, izleme listeme ekle" onClick={() => void feedback(s, 'interested')}>{compact ? '+' : '+ Listeme ekle'}</button>
    <button type="button" disabled={busy} title="Bana uygun değil" aria-label="Bana uygun değil" onClick={() => void feedback(s, 'dismissed')}>✕</button>
  </div>

  return <section className="film-discovery" aria-labelledby="discovery-heading" aria-busy={result.loading || busy}>
    <div className="discovery-head">
      <h1 id="discovery-heading">Şimdi ne izlemeli?</h1>
      {data && <button type="button" className="discovery-refresh" disabled={busy || result.loading} onClick={() => { setHidden([]); setRevision(r => r + 1) }}>↻ Yenile</button>}
    </div>
    {result.loading && <p className="muted" role="status">Öneriler yükleniyor…</p>}
    <ErrorBox message={result.error || error} retry={result.error ? result.retry : undefined} />
    {message && <p className="save-message" role="status">{message}</p>}
    {data && <>
      <PreferencePanel initial={data.preferences} onSaved={() => { setHidden([]); setRevision(r => r + 1) }} />
      {data.catalogNotice && <p className="muted" role="status">{data.catalogNotice}</p>}
      {!items.length && <p className="muted">Yeni öneri yok. <a className="text-link" href={base + 'catalog'}>Kataloğu keşfet</a></p>}
      {featured.length > 0 && <div className="featured-screens">{featured.map(s => <article className="featured-screen" key={s.movie.id}>
        <a className="featured-poster" href={base + 'movie/' + s.movie.id} aria-label={`${s.movie.title} detaylarını görüntüle`}><MiniPoster movie={s.movie} /></a>
        <div><p className="kicker">{s.shelf === 'perfect' ? 'DÖRT DÖRTLÜK' : s.shelf === 'discovery' ? 'BAŞKA BİR TÜR' : 'SANA GÖRE'}</p>
          <h2><a href={base + 'movie/' + s.movie.id}>{s.movie.title}</a></h2>
          {s.reasons[0] && <p>{s.reasons[0]}</p>}{actions(s)}</div>
      </article>)}</div>}
      <CircleFeed watching={data.watching} reviews={data.reviews} />
      {[{ key: 'perfect', title: 'Dört dörtlük eşleşmeler' }, { key: 'personal', title: 'Sana göre diziler' }, { key: 'discovery', title: 'Başka türlerde, aynı keyif' }].map(shelf => {
        const films = items.filter(s => !featured.includes(s) && s.shelf === shelf.key).slice(0, 6)
        if (!films.length) return null
        return <section key={shelf.key} className={'film-shelf film-shelf-' + shelf.key} aria-labelledby={'shelf-' + shelf.key}>
          <h3 id={'shelf-' + shelf.key}>{shelf.title}</h3>
          <div className="film-row">{films.map(s => <article className="film-tile" key={s.movie.id}>
            <div className="film-tile-poster"><a href={base + 'movie/' + s.movie.id} title={s.reasons.join(' ')} aria-label={`${s.movie.title} detaylarını görüntüle`}><MiniPoster movie={s.movie} /></a>{actions(s, true)}</div>
            <h4><a href={base + 'movie/' + s.movie.id}>{s.movie.title}</a></h4>
          </article>)}</div>
        </section>
      })}
    </>}
  </section>
}

/** "İzleme tercihlerim" as one quiet line (as on the Books home); the choices open only behind "Düzenle". */
function PreferencePanel({ initial, onSaved }: { initial: Preference; onSaved: () => void }) {
  const { api, reload } = useCommunity()
  const formId = useId()
  const editButton = useRef<HTMLButtonElement>(null)
  const [saved, setSaved] = useState(initial)
  const [value, setValue] = useState(initial)
  const hasChoices = saved.genres.length + saved.criteria.length > 0
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const genres = useResource<{ id: number; name: string }[]>('/api/series/genres')
  useEffect(() => { setSaved(initial); setValue(initial) }, [initial])
  function toggle<K extends keyof Preference>(key: K, item: Preference[K][number]) {
    setValue(p => ({ ...p, [key]: (p[key] as (typeof item)[]).includes(item) ? (p[key] as (typeof item)[]).filter(x => x !== item) : [...p[key], item] }))
  }
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      await api('/api/series/community/preferences', { method: 'PUT', ...json(value) })
      setSaved(value); setOpen(false); reload(); onSaved()
      requestAnimationFrame(() => editButton.current?.focus())
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const names = genres.data?.filter(g => saved.genres.includes(g.id)).map(g => g.name) ?? []
  return <div className="film-preferences">
    <div className="film-preferences-head">
      <div><h3 className="sr-only">İzleme tercihlerim</h3><p>{names.length ? names.join(' · ') : hasChoices ? 'Tüm türlere açığım' : 'Sevdiğin dizi türlerini seç'}{saved.criteria.length > 0 && ` · ${saved.criteria.length} izleme önceliği`}</p></div>
      <button ref={editButton} type="button" aria-expanded={open} aria-controls={formId} disabled={busy}
        onClick={() => { setValue(saved); setError(''); setOpen(o => !o) }}>{open ? 'Vazgeç' : hasChoices ? 'Düzenle' : 'Tercih seç'}</button>
    </div>
    <form id={formId} hidden={!open} onSubmit={e => void save(e)}>
      <fieldset disabled={busy}><legend>Dizi türleri <small>En fazla 5</small></legend>
        <ErrorBox message={genres.error} retry={genres.retry} />
        <div className="choice-chips">{genres.data?.map(g => <label key={g.id}><input type="checkbox" checked={value.genres.includes(g.id)} disabled={!value.genres.includes(g.id) && value.genres.length >= 5} onChange={() => toggle('genres', g.id)} /><span>{g.name}</span></label>)}</div>
      </fieldset>
      <fieldset disabled={busy}><legend>Bir dizide en çok neye önem verirsin? <small>En fazla 3</small></legend>
        <div className="choice-chips">{Object.entries(criteria).map(([key, label]) => <label key={key}><input type="checkbox" checked={value.criteria.includes(key)} disabled={!value.criteria.includes(key) && value.criteria.length >= 3} onChange={() => toggle('criteria', key)} /><span>{label}</span></label>)}</div>
      </fieldset>
      <ErrorBox message={error} />
      <button className="primary" disabled={busy}>{busy ? 'Kaydediliyor…' : 'Tercihlerimi kaydet'}</button>
    </form>
  </div>
}

/** "İzleyici çevrenden": what followed people are watching and how followers rated, newest first. */
function CircleFeed({ watching, reviews }: { watching: Activity[]; reviews: Activity[] }) {
  const items = [...watching.map(a => ({ ...a, kind: 'watching' as const })), ...reviews.map(a => ({ ...a, kind: 'review' as const }))]
    .sort((a, b) => b.updatedAtUtc.localeCompare(a.updatedAtUtc)).slice(0, 12)
  return <section className="circle-feed" aria-labelledby="circle-heading">
    <h2 id="circle-heading">İzleyici çevrenden</h2>
    {!items.length ? <p className="circle-empty">Takip ettiklerin burada görünür. <a className="text-link" href={base + 'people'}>Dizi severleri keşfet ↗</a></p>
      : <ol>{items.map(a => <li key={a.kind + a.nickname + a.movie.id}>
        <a className="circle-poster" href={base + 'movie/' + a.movie.id} aria-label={a.movie.title}><MiniPoster movie={a.movie} /></a>
        <div>
          <a className="circle-user" href={base + 'people/' + encodeURIComponent(a.nickname)}><CinemaAvatar id={a.avatarId} /><span>@{a.nickname}</span></a>
          <a className="circle-title" href={base + 'movie/' + a.movie.id}>{a.movie.title}</a>
          <span className="circle-meta">{a.kind === 'review' ? `${a.overall?.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} / 10 verdi` : 'Şu an izliyor'} · <time dateTime={a.updatedAtUtc}>{new Date(a.updatedAtUtc).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}</time></span>
        </div>
      </li>)}</ol>}
  </section>
}

/** "İzleme listemden": watchlist films with a one-tap start. */
function WatchlistShelf() {
  const { me, api, reload } = useCommunity()
  const [busy, setBusy] = useState(0), [error, setError] = useState(''), [message, setMessage] = useState('')
  const rows = me?.entries.filter(r => r.entry.state === 'watchlist').slice(0, 6) ?? []
  async function start(row: FilmRow) {
    setBusy(row.movie.id); setError(''); setMessage('')
    try { await api('/api/series/community/entry/' + row.movie.id, { method: 'PUT', ...json({ state: 'watching', scores: null }) }); setMessage(`«${row.movie.title}» artık “İzliyorum” listende. İyi seyirler!`); reload() }
    catch (e) { setError((e as Error).message) } finally { setBusy(0) }
  }
  return <section className="film-discovery film-watchlist" aria-labelledby="watchlist-heading">
    <h2 id="watchlist-heading">İzleme listemden</h2>
    {message && <p className="save-message" role="status">{message}</p>}
    <ErrorBox message={error} />
    {!rows.length ? <p className="muted">Listende bekleyen dizi yok. <a className="text-link" href={base + 'catalog'}>İzleme listene dizi ekle</a></p>
      : <div className="film-row">{rows.map(row => <article className="film-tile" key={row.movie.id}>
        <div className="film-tile-poster"><a href={base + 'movie/' + row.movie.id} aria-label={`${row.movie.title} detaylarını görüntüle`}><MiniPoster movie={row.movie} /></a></div>
        <h4><a href={base + 'movie/' + row.movie.id}>{row.movie.title}</a></h4>
        <button type="button" className="film-start" disabled={!!busy} onClick={() => void start(row)}>{busy === row.movie.id ? 'Kaydediliyor…' : 'İzlemeye başla'}</button>
      </article>)}</div>}
  </section>
}

/** "Değerlendir": watched films without scores, linking straight to the rating panel. */
function RatingPrompts() {
  const { me } = useCommunity()
  const [hidden, setHidden] = useState(false)
  // One row, as on the Books home: the three most recently watched films without a rating.
  const rows = me?.entries.filter(r => r.entry.state === 'watched' && !r.entry.scores).slice(0, 3) ?? []
  if (!rows.length) return null
  if (hidden) return <button className="rating-restore" onClick={() => setHidden(false)}>Değerlendirilecek dizilerimi göster</button>
  return <section className="rating-band" aria-labelledby="rating-heading">
    <header><h2 id="rating-heading">Değerlendir</h2><button className="rating-hide" onClick={() => setHidden(true)}>Gizle</button></header>
    <ul>{rows.map(row => <li key={row.movie.id}>
      <a className="rating-film" href={base + 'movie/' + row.movie.id}><span className="rating-cover"><MiniPoster movie={row.movie} /></span><b>{row.movie.title}</b></a>
      <a className="outline-button" href={base + 'movie/' + row.movie.id + '#degerlendir'}>Değerlendir</a>
    </li>)}</ul>
  </section>
}

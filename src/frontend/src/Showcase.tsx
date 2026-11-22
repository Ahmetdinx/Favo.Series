import { useEffect, useRef, useState } from 'react'
import { FilmCover, useCommunity, useResource, type Film } from './Community'
import './showcase.css'

const base = import.meta.env.BASE_URL
const positions = [1, 2, 3, 4, 5]

export type ShowcaseData = { lifeFilmId: number | null; influential: { movieId: number; position: number }[]; films: Film[] }

/** What waits for confirmation before it is saved: replacing the life film, or one of five full positions. */
type Pending = { kind: 'life' } | { kind: 'influential'; position: number | null }

/**
 * One-tap buttons on the film page that put the film on the profile as "Hayatımın dizisi" or among the five films
 * that left a mark (Books' bedside / "İz bırakanlar" buttons). Replacing an existing choice asks first.
 */
export function ShowcasePicks({ id }: { id: number }) {
  const { account, api } = useCommunity()
  const loaded = useResource<ShowcaseData>(account.session ? '/api/series/community/showcase' : null)
  const [showcase, setShowcase] = useState<ShowcaseData | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  useEffect(() => { setShowcase(loaded.data) }, [loaded.data])
  if (!account.session || !showcase) return null

  const isLife = showcase.lifeFilmId === id
  const current = showcase.influential.find(p => p.movieId === id) ?? null
  const titleOf = (movieId: number) => showcase.films.find(f => f.id === movieId)?.title ?? 'kayıtlı dizi'

  async function run(path: string, method: 'PUT' | 'DELETE', body: object | null, success: string) {
    setBusy(true); setMessage(null)
    try {
      setShowcase(await api<ShowcaseData>('/api/series/community/showcase/' + path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }))
      setPending(null); setMessage({ text: success, error: false })
    } catch (e) { setMessage({ text: (e as Error).message || 'İşlem tamamlanamadı. Lütfen tekrar dene.', error: true }) }
    finally { setBusy(false) }
  }
  const saveLife = () => run('life', 'PUT', { movieId: id }, 'Hayatının dizisi oldu.')
  const saveInfluential = (position: number) => run('influential/' + position, 'PUT', { movieId: id }, 'İz bırakanlara eklendi.')
  function lifeClick() {
    if (busy) return
    if (isLife) { void run('life', 'DELETE', null, 'Hayatının dizisi olmaktan çıkarıldı.'); return }
    if (showcase!.lifeFilmId) { setMessage(null); setPending({ kind: 'life' }); return }
    void saveLife()
  }
  function influentialClick() {
    if (busy) return
    if (current) { void run('influential/' + current.position, 'DELETE', null, 'İz bırakanlardan çıkarıldı.'); return }
    const free = positions.find(p => !showcase!.influential.some(i => i.position === p))
    if (free) { void saveInfluential(free); return }
    setMessage(null); setPending({ kind: 'influential', position: null })
  }

  return <div className="showcase-picks">
    <div className="showcase-pick-buttons">
      <button type="button" className="showcase-pick" aria-pressed={isLife} disabled={busy} onClick={lifeClick} title={isLife ? 'Hayatımın dizisinden çıkar' : undefined}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>
        {isLife ? 'Hayatının dizisi' : 'Hayatımın dizisi yap'}
      </button>
      <button type="button" className="showcase-pick" aria-pressed={!!current} disabled={busy} onClick={influentialClick} title={current ? 'İz bırakanlardan çıkar' : undefined}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7Z" /></svg>
        {current ? `İz bırakanlarda · ${current.position}.` : `İz bırakanlara ekle · ${showcase.influential.length}/5`}
      </button>
    </div>
    {pending?.kind === 'life' && showcase.lifeFilmId && <div className="showcase-confirm" role="dialog" aria-label="Hayatımın dizisini değiştir">
      <p>Hayatının dizisi şu an <strong>{titleOf(showcase.lifeFilmId)}</strong>. Yerine bu diziyi koyalım mı?</p>
      <div className="showcase-confirm-actions"><button type="button" className="primary" disabled={busy} onClick={() => void saveLife()}>Evet, değiştir</button><button type="button" className="film-link-button" onClick={() => setPending(null)}>Vazgeç</button></div>
    </div>}
    {pending?.kind === 'influential' && <div className="showcase-confirm" role="dialog" aria-label="İz bırakan diziyi değiştir">
      <p>Beş yer de dolu. Bu dizi hangisinin yerine geçsin?</p>
      <ol className="showcase-slots">{showcase.influential.map(item => <li key={item.position}><label>
        <input type="radio" name="showcase-slot" checked={pending.position === item.position} onChange={() => setPending({ kind: 'influential', position: item.position })} />
        <span>{item.position}.</span>{titleOf(item.movieId)}</label></li>)}</ol>
      <div className="showcase-confirm-actions"><button type="button" className="primary" disabled={busy || pending.position == null} onClick={() => pending.position != null && void saveInfluential(pending.position)}>Onayla</button><button type="button" className="film-link-button" onClick={() => setPending(null)}>Vazgeç</button></div>
    </div>}
    {message && <p className={'showcase-message' + (message.error ? ' error' : '')} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
  </div>
}

/** Own profile: loads the showcase itself. */
export function OwnShowcase() {
  const showcase = useResource<ShowcaseData>('/api/series/community/showcase')
  if (!showcase.data) return null
  return <ShowcaseShelf showcase={showcase.data} own />
}

/** The profile spread: the life film on the left, the five films that left a mark on a scrollable shelf. */
export function ShowcaseShelf({ showcase, own }: { showcase: ShowcaseData; own: boolean }) {
  const shelf = useRef<HTMLOListElement>(null)
  const byId = new Map(showcase.films.map(f => [f.id, f]))
  const life = showcase.lifeFilmId ? byId.get(showcase.lifeFilmId) : undefined
  if (!own && !life && showcase.influential.length === 0) return null
  function scroll(direction: number) {
    const card = shelf.current?.querySelector('li')
    shelf.current?.scrollBy({ left: direction * ((card?.getBoundingClientRect().width ?? 180) + 16) })
  }
  const slots = own ? positions : showcase.influential.map(p => p.position)
  return <section className="showcase" aria-label="Dizi vitrini">
    {(own || life) && <article className="showcase-life" aria-labelledby="showcase-life-heading">
      <h2 id="showcase-life-heading">{own ? 'Hayatımın dizisi' : 'Hayatının dizisi'}</h2>
      <div className="showcase-life-cover">{life
        ? <a href={base + 'movie/' + life.id} aria-label={life.title}><FilmCover movie={life} /></a>
        : <div className="showcase-empty-cover" aria-hidden="true"><span>F</span><small>Hayatımın<br />filmi</small></div>}</div>
      <div className="showcase-life-copy">
        {life ? <><h3><a href={base + 'movie/' + life.id}>{life.title}</a></h3><p className="showcase-meta">{[life.director, life.year].filter(Boolean).join(' · ')}</p></>
          : <p className="showcase-meta">Bir dizi sayfasında “Hayatımın dizisi yap” de.</p>}
        {own && <a className="showcase-link" href={life ? base + 'movie/' + life.id : base + 'catalog'}>{life ? 'Diziye git' : 'Dizi seç'} <span aria-hidden="true">↗</span></a>}
      </div>
    </article>}
    {(own || showcase.influential.length > 0) && <section className="showcase-influential" aria-labelledby="showcase-influential-heading">
      <header><h2 id="showcase-influential-heading">İz bırakanlar</h2>
        <div className="showcase-controls"><span aria-label={showcase.influential.length + ' dizi seçildi, en fazla 5'}>{showcase.influential.length} / 5</span>
          {showcase.influential.length > 0 && <><button type="button" aria-label="Önceki dizilere kaydır" aria-controls="showcase-shelf" onClick={() => scroll(-1)}>←</button><button type="button" aria-label="Sonraki dizilere kaydır" aria-controls="showcase-shelf" onClick={() => scroll(1)}>→</button></>}</div>
      </header>
      {showcase.influential.length === 0
        ? <div className="showcase-shelf-empty"><p>Seni en çok etkileyen beş diziyi dizi sayfalarından seçebilirsin.</p><a className="outline-button" href={base + 'catalog'}>Dizi seç</a></div>
        : <ol id="showcase-shelf" className="showcase-shelf" ref={shelf} tabIndex={0} aria-label="En çok etkileyen beş dizi; yatay kaydırılabilir raf">
          {slots.map(position => {
            const pick = showcase.influential.find(p => p.position === position)
            const film = pick ? byId.get(pick.movieId) : undefined
            return <li key={position} className={'showcase-card' + (film ? '' : ' empty')}>
              <span className="showcase-rank" aria-label={position + '. sıra'}>{String(position).padStart(2, '0')}</span>
              {film ? <><a className="showcase-card-cover" href={base + 'movie/' + film.id} aria-label={film.title}><FilmCover movie={film} /></a>
                <div className="showcase-card-copy"><h3><a href={base + 'movie/' + film.id}>{film.title}</a></h3><p className="showcase-meta">{[film.director, film.year].filter(Boolean).join(' · ')}</p></div></>
                : <a className="showcase-card-add" href={base + 'catalog'}><span aria-hidden="true">+</span><strong>Dizi ekle</strong><small>Seni etkileyen bir dizi</small></a>}
            </li>
          })}
        </ol>}
    </section>}
  </section>
}

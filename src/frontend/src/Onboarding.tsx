import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import AccountDialog from './auth/AccountDialog'
import { ErrorBox, MiniPoster, useCommunity, useResource, type Entry, type Film } from './Community'
import { TasteCard, type Journey } from './Journey'
import { clearInvite, hasSeenOnboarding, markOnboardingSeen, pendingInvite } from './invite'
import './onboarding.css'

const base = import.meta.env.BASE_URL
const maxGenres = 5
const targetFilms = 5
type Genre = { id: number; name: string; count: number }
type Page = { items: Film[] }
type Suggestion = { movie: Film; reasons: string[] }
type Step = 'genres' | 'films' | 'results'

/** The Books first-run guide for films: pick genres, mark what you watched, see your identity and first suggestions. */
export function Onboarding() {
  const { account, me, api, reload } = useCommunity()
  const [step, setStep] = useState<Step>('genres')
  const [genres, setGenres] = useState<number[] | null>(null)
  const [error, setError] = useState(''), [saving, setSaving] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const available = useResource<Genre[]>('/api/series/genres')
  useEffect(() => { if (me && genres === null) setGenres(me.preferences?.genres ?? []) }, [me, genres])
  useEffect(() => { heading.current?.focus() }, [step])

  if (account.initializing) return <p role="status">Yükleniyor…</p>
  if (!account.session) return <section className="profile-gate"><h1>Zevkini tanıyalım<em>.</em></h1><p>Rehberi başlatmak için giriş yap.</p><AccountDialog account={account} /></section>

  function finish() {
    markOnboardingSeen(account.session!.userId)
    // Visitors who came from a shared profile go back to it to see their match.
    const invite = pendingInvite()
    clearInvite()
    location.assign(invite ? base + 'people/' + encodeURIComponent(invite) : base)
  }
  async function saveGenres(event: FormEvent) {
    event.preventDefault()
    setSaving(true); setError('')
    try {
      await api('/api/series/community/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ genres: genres ?? [], criteria: me?.preferences?.criteria ?? [] }) })
      reload(); setStep('films')
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }
  const stepNumber = step === 'genres' ? 1 : step === 'films' ? 2 : 3
  const chosen = genres ?? []
  return <section className="onboarding" aria-labelledby="onboarding-heading">
    <header className="onboarding-top">
      <ol className="onboarding-progress" aria-label={`Adım ${stepNumber} / 3`}>
        {['Türler', 'İzlediklerin', 'Önerilerin'].map((label, i) => <li key={label} className={i + 1 === stepNumber ? 'current' : i + 1 < stepNumber ? 'done' : ''} aria-current={i + 1 === stepNumber ? 'step' : undefined}>{label}</li>)}
      </ol>
      {step !== 'results' && <button type="button" className="onboarding-skip" onClick={finish}>Sonra yaparım</button>}
    </header>
    <ErrorBox message={error || available.error} />
    {step === 'genres' && <form onSubmit={e => void saveGenres(e)}>
      <h1 id="onboarding-heading" ref={heading} tabIndex={-1}>Hangi diziler seni <em>içine çeker?</em></h1>
      <p className="onboarding-lead">En fazla {maxGenres} tür seç. Önerilerin ve bir sonraki adımdaki filmler buna göre gelir.</p>
      {!available.data && <p role="status">Türler yükleniyor…</p>}
      {available.data && <fieldset className="onboarding-genres"><legend className="sr-only">Dizi türleri</legend>
        {available.data.map(genre => { const checked = chosen.includes(genre.id)
          return <label key={genre.id} className={checked ? 'selected' : ''}>
            <input type="checkbox" checked={checked} disabled={!checked && chosen.length >= maxGenres} onChange={() => setGenres(checked ? chosen.filter(g => g !== genre.id) : [...chosen, genre.id])} />{genre.name}</label> })}
      </fieldset>}
      <div className="onboarding-actions">
        <span className="onboarding-count">{chosen.length} / {maxGenres} seçildi</span>
        <button className="primary" disabled={!available.data || saving || genres === null}>{saving ? 'Kaydediliyor…' : chosen.length ? 'Devam et' : 'Tür seçmeden devam et'}</button>
      </div>
    </form>}
    {step === 'films' && <FilmsStep headingRef={heading} genres={chosen} onBack={() => setStep('genres')} onNext={() => setStep('results')} />}
    {step === 'results' && <ResultsStep headingRef={heading} onFinish={finish} />}
  </section>
}

function FilmsStep({ genres, onBack, onNext, headingRef }: { genres: number[]; onBack: () => void; onNext: () => void; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  const { me, api } = useCommunity()
  const [films, setFilms] = useState<Film[] | null>(null)
  const [query, setQuery] = useState(''), [results, setResults] = useState<Film[] | null>(null)
  const [watched, setWatched] = useState<Record<number, boolean>>(() => Object.fromEntries((me?.entries ?? []).filter(r => r.entry.state === 'watched').map(r => [r.movie.id, true])))
  const [pending, setPending] = useState<number[]>([]), [error, setError] = useState('')
  const existing = useMemo(() => Object.fromEntries((me?.entries ?? []).map(r => [r.movie.id, r.entry])) as Record<number, Entry>, [me])
  useEffect(() => {
    const controller = new AbortController()
    const lists = genres.length ? genres.map(String) : ['']
    Promise.all(lists.map(g => fetch(`/api/series/?sort=popular&page=1${g ? '&genre=' + g : ''}`, { signal: controller.signal }).then(r => r.json() as Promise<Page>)))
      .then(pages => {
        // Interleave the genres so the first rows mix every choice instead of filling up with one.
        const seen = new Set<number>(), merged: Film[] = []
        for (let i = 0; i < 20; i++) for (const page of pages) { const film = page.items[i]; if (film && !seen.has(film.id)) { seen.add(film.id); merged.push(film) } }
        setFilms(merged.slice(0, 36))
      }).catch(() => { if (!controller.signal.aborted) setError('Diziler yüklenemedi. Sayfayı yenileyip tekrar dene.') })
    return () => controller.abort()
  }, [genres])
  useEffect(() => {
    const text = query.trim()
    if (text.length < 2) { setResults(null); return }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      fetch('/api/series/?query=' + encodeURIComponent(text), { signal: controller.signal }).then(r => r.json() as Promise<Page>)
        .then(page => setResults(page.items.slice(0, 12))).catch(() => { if (!controller.signal.aborted) setResults([]) })
    }, 250)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [query])
  async function toggle(film: Film) {
    if (pending.includes(film.id)) return
    setPending(p => [...p, film.id]); setError('')
    try {
      if (watched[film.id]) {
        await api('/api/series/community/entry/' + film.id, { method: 'DELETE' })
        setWatched(({ [film.id]: _removed, ...rest }) => rest)
      } else {
        if (existing[film.id] && existing[film.id].state !== 'watchlist') throw Error(`«${film.title}» zaten arşivinde başka bir rafta duruyor.`)
        await api('/api/series/community/entry/' + film.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'watched', scores: null }) })
        setWatched(w => ({ ...w, [film.id]: true }))
      }
    } catch (e) { setError((e as Error).message) } finally { setPending(p => p.filter(id => id !== film.id)) }
  }
  const count = Object.keys(watched).length
  const shown = results ?? films
  return <div>
    <h1 id="onboarding-heading" ref={headingRef} tabIndex={-1}>Hangilerini <em>izledin?</em></h1>
    <p className="onboarding-lead">İzlediklerine dokun, “İzledim” rafına eklensin. En az {targetFilms} dizi seçersen öneriler ve izleyici kimliğin gerçekten sana göre olur.</p>
    <div className="onboarding-search"><label htmlFor="onboarding-search" className="sr-only">Dizi ya da yaratıcı ara</label>
      <input id="onboarding-search" type="search" placeholder="Listede yok mu? Dizi ya da yaratıcı ara…" value={query} onChange={e => setQuery(e.target.value)} /></div>
    <ErrorBox message={error} />
    {!shown && !error && <p role="status">Diziler yükleniyor…</p>}
    {results && results.length === 0 && <p role="status">Bu aramayla eşleşen dizi bulunamadı.</p>}
    {shown && <ul className="onboarding-films">{shown.map(film => { const selected = !!watched[film.id]
      return <li key={film.id}>
        <button type="button" aria-pressed={selected} disabled={pending.includes(film.id)} className={selected ? 'selected' : ''} onClick={() => void toggle(film)}
          aria-label={`${film.title}: ${selected ? 'izledim, geri al' : 'izledim olarak işaretle'}`}><MiniPoster movie={film} /><span className="onboarding-check" aria-hidden="true">✓</span></button>
        <span className="onboarding-film-title">{film.title}</span>{film.year && <span className="onboarding-film-year">{film.year}</span>}
      </li> })}</ul>}
    <div className="onboarding-actions sticky">
      <button type="button" className="outline-button" onClick={onBack}>Geri</button>
      <span className="onboarding-count" role="status">{count} dizi işaretlendi{count < targetFilms ? ` · ${targetFilms - count} tane daha önerilir` : ''}</span>
      <button type="button" className="primary" onClick={onNext}>{count ? 'Önerilerimi göster' : 'Atla'}</button>
    </div>
  </div>
}

function ResultsStep({ onFinish, headingRef }: { onFinish: () => void; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  const home = useResource<{ suggestions: Suggestion[] }>('/api/series/community/home')
  const journey = useResource<Journey>('/api/series/community/journey?onboarding=1')
  const items = home.data?.suggestions.slice(0, 6)
  const revealed = journey.data?.taste.ready ? journey.data.taste : null
  const invite = pendingInvite()
  return <div>
    {revealed && <section className="onboarding-identity">
      <div className="onboarding-identity-copy"><p className="kicker">İzleyici kimliğin hazır</p>
        <h1 id="onboarding-heading" ref={headingRef} tabIndex={-1}>{revealed.title}</h1>
        <p className="onboarding-lead">İşaretlediğin dizilerden çıkardık. Profilindeki kimlik kartından hikâyende paylaşabilirsin; gören arkadaşların kendi kimliklerini çıkarsın.</p></div>
      <TasteCard taste={revealed} own />
    </section>}
    {revealed ? <h2 className="onboarding-subheading">Sana göre <em>{items?.length || ''} dizi</em></h2>
      : <h1 id="onboarding-heading" ref={headingRef} tabIndex={-1}>Sana göre <em>{items?.length || ''} dizi</em></h1>}
    <p className="onboarding-lead">Seçtiklerine bakarak bunları hazırladık. Ana sayfada “İlgimi çekti” ya da “Bana uygun değil” dedikçe öneriler keskinleşir.</p>
    <ErrorBox message={home.error} retry={home.retry} />
    {!items && !home.error && <p role="status">Öneriler hazırlanıyor…</p>}
    {items && items.length === 0 && <p>Şimdilik öneri çıkmadı. Kataloğa göz atıp birkaç dizi ekledikçe burası dolacak.</p>}
    {items && items.length > 0 && <ol className="onboarding-results">{items.map(s => <li key={s.movie.id}>
      <a className="onboarding-result-cover" href={base + 'movie/' + s.movie.id} aria-label={s.movie.title + ' detayları'}><MiniPoster movie={s.movie} /></a>
      <div><h2><a href={base + 'movie/' + s.movie.id}>{s.movie.title}</a></h2>{s.reasons[0] && <p className="onboarding-reason">{s.reasons[0]}</p>}
        <p className="onboarding-meta">{[s.movie.year, s.movie.director].filter(Boolean).join(' · ')}</p></div>
    </li>)}</ol>}
    <ProfileVisibilityChoice />
    <div className="onboarding-actions"><button type="button" className="primary" onClick={onFinish}>{invite ? '@' + invite + ' ile uyumumu gör' : 'Dizi arşivime geç'}</button></div>
  </div>
}

// Profiles start private; following needs both sides public, so the choice is offered here explicitly.
function ProfileVisibilityChoice() {
  const { me, api, reload } = useCommunity()
  const [state, setState] = useState<'private' | 'public' | 'saving' | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { if (me && state === null) setState(me.isPublic ? null : 'private') }, [me, state])
  if (!me || me.isPublic && state !== 'public' || state === null) return null
  async function open() {
    setState('saving'); setError('')
    try { await api('/api/people/me', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: me!.nickname, isPublic: true }) }); setState('public'); reload() }
    catch (e) { setError((e as Error).message); setState('private') }
  }
  return <aside className="onboarding-visibility" aria-live="polite">
    {state === 'public' ? <p><strong>Profilin artık herkese açık.</strong> Diğer izleyicileri takip edebilir, seni bulabilirler. İstediğin zaman profil ayarlarından gizleyebilirsin.</p>
      : <><div><strong>Profilin şu an gizli</strong><p>İzleyicileri takip etmek ve takip edilmek için profilinin herkese açık olması gerekir. Herkese açık profilde kullanıcı adın, arşivin ve puanların görünür; e-posta adresin asla görünmez.</p></div>
        <button type="button" className="outline-button" disabled={state === 'saving' || !me.nickname} onClick={() => void open()}>{state === 'saving' ? 'Açılıyor…' : 'Profilimi herkese aç'}</button></>}
    <ErrorBox message={error} />
  </aside>
}

/** Home card for viewers with an almost empty archive (Google sign-ups, or anyone who skipped the guide). */
export function OnboardingHomeCard() {
  const { account, me } = useCommunity()
  const userId = account.session?.userId
  const [hidden, setHidden] = useState(false)
  if (!userId || !me || hidden || hasSeenOnboarding(userId) || me.entries.length >= targetFilms) return null
  return <aside className="onboarding-home-card" aria-labelledby="onboarding-card-heading">
    <div><h2 id="onboarding-card-heading">Zevkini tanıyalım</h2><p>Sevdiğin türleri seç, izlediğin birkaç diziyi işaretle; önerilerin iki dakikada sana göre olsun.</p></div>
    <a className="primary" href={base + 'baslangic'}>Başlayalım</a>
    <button type="button" className="onboarding-skip" onClick={() => { markOnboardingSeen(userId); setHidden(true) }}>Gizle</button>
  </aside>
}

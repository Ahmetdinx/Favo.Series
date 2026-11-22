import { useEffect, useState, type FormEvent } from 'react'
import AccountDialog from './auth/AccountDialog'
import { Celebration } from './Celebration'
import MarginReels from './MarginReels'
import HeaderSearch from './HeaderSearch'
import { CommunityProvider, FilmCover, ProfileLink, NicknameLink, People, useCommunity } from './Community'
import { FilmProfile, PublicProfile } from './Profile'
import { SummaryPage } from './Journey'
import { FilmDetail, type FilmDetailData } from './FilmDetail'
import { CatalogWatchActions, useWatchActions } from './watch'
import { Onboarding } from './Onboarding'
import { captureInviteFromUrl, registerUrl } from './invite'
import { captureCampaign } from './campaign'
import FilmHome from './Home'
import { useSession } from './auth/useSession'

type Film = { id: number; title: string; originalTitle: string | null; posterUrl: string | null; year: number | null; director: string | null }
type Genre = { id: number; name: string; count: number }
type Page = { items: Film[]; page: number; totalPages: number; totalResults: number; approximate?: boolean }
type Failure = { code: string; message: string }
const base = import.meta.env.BASE_URL

function useData<T>(url: string) {
 const [data, setData] = useState<T | null>(null)
 const [error, setError] = useState<Failure | null>(null)
 const [loading, setLoading] = useState(true)
 const [revision, setRevision] = useState(0)
 useEffect(() => {
  const controller = new AbortController(); setLoading(true); setError(null) // The previous result stays on screen while the next one loads, so typing does not flash.
  void fetch(url, { signal: controller.signal }).then(async response => {
   const result = await response.json()
   if (!response.ok) throw { code: result.code ?? 'unavailable', message: result.message ?? 'Dizi bilgileri yüklenemedi.' }
   if (!controller.signal.aborted) setData(result)
  }).catch((failure: Failure) => { if (!controller.signal.aborted) { setData(null); setError({ code: failure.code ?? 'offline', message: failure.message ?? 'Bağlantı kurulamadı.' }) } })
   .finally(() => { if (!controller.signal.aborted) setLoading(false) })
  return () => controller.abort()
 }, [url, revision])
 return { data, error, loading, retry: () => setRevision(n => n + 1) }
}
function Poster({ movie }: { movie: Film }) {
 const [failed, setFailed] = useState(false)
 return movie.posterUrl && !failed ? <img src={movie.posterUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
  : <FilmCover movie={movie}/>
}
function Status({ error, retry }: { error: Failure; retry: () => void }) {
 const setup = error.code === 'catalog_unavailable'
 return <section className="catalog-state" role={setup ? 'status' : 'alert'}><span className="state-symbol" aria-hidden="true">{setup ? '◷' : '↻'}</span><div><h2>{setup ? 'Bölüm başlamak üzere.' : 'Kısa bir ara.'}</h2><p>{setup ? error.message : error.message}</p></div><button className="outline-button" onClick={retry}>Tekrar dene <span aria-hidden="true">↗</span></button></section>
}
const currentYear = new Date().getFullYear()
function Catalog() {
 const watch = useWatchActions()
 // The address bar follows the search as it is typed (no reload), as on the Books catalog.
 const [search, setSearch] = useState(location.search)
 const params = new URLSearchParams(search)
 const initialQuery = params.get('query') ?? ''
 const genre = params.get('genre') ?? ''
 const sort = params.get('sort') ?? 'mixed'
 const [query, setQuery] = useState(initialQuery)
 const request = useData<Page>('/api/series/?' + params.toString())
 const genres = useData<Genre[]>('/api/series/genres')
 function href(changes: Record<string, string>) {
  const next = new URLSearchParams(params); next.delete('page')
  for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key) }
  if (next.get('sort') === 'mixed') next.delete('sort')
  return base + 'catalog' + (next.size ? '?' + next : '')
 }
 useEffect(() => {
  const term = query.trim()
  if (term === (new URLSearchParams(search).get('query') ?? '')) return
  const timer = window.setTimeout(() => {
   const next = new URLSearchParams(search); next.delete('page')
   if (term) next.set('query', term); else next.delete('query')
   const value = next.size ? '?' + next : ''
   history.replaceState(null, '', base + 'catalog' + value)
   setSearch(value)
  }, 300)
  return () => window.clearTimeout(timer)
 }, [query, search])
 function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault() }
 function pageLink(page: number) { const next = new URLSearchParams(params); next.set('page', String(page)); return base + 'catalog?' + next.toString() }
 return <>
  <header className="catalog-head"><div><p className="kicker">DİZİ ARŞİVİ</p><h1>Katalog</h1><p className="muted catalog-total">{request.data
    ? `${request.data.totalResults.toLocaleString('tr-TR')} dizi ${genre || initialQuery || params.get('year') ? 'bulundu' : 'arşivde'}${request.data.approximate ? ' · yazımı benzeyenler gösteriliyor' : ''}`
    : 'Arşiv hazırlanıyor…'}</p></div>
   <form className="catalog-search" role="search" onSubmit={submit}><label className="sr-only" htmlFor="catalog-query">Dizi adı</label><input id="catalog-query" name="query" type="search" placeholder="Dizi adıyla ara…" value={query} onChange={event => setQuery(event.target.value)} maxLength={120}/></form>
  </header>
  <section id="catalog" aria-label="Dizi kataloğu">
   {genres.data && <nav className="genre-chips" aria-label="Türler"><a href={href({ genre: '' })} aria-current={!genre && !initialQuery ? 'true' : undefined}>Tüm türler</a>{genres.data.filter(g => g.count > 0 || genre === String(g.id)).map(g => <a key={g.id} href={href({ genre: String(g.id) })} aria-current={genre === String(g.id) ? 'true' : undefined}>{g.name}<small>{g.count.toLocaleString('tr-TR')}</small></a>)}</nav>}
   <div className="catalog-filters">
    <label>Yıl<select value={params.get('year') ?? ''} onChange={event => location.assign(href({ year: event.target.value }))}><option value="">Tümü</option>{Array.from({ length: currentYear - 1919 }, (_, i) => currentYear + 1 - i).map(y => <option key={y} value={y}>{y}</option>)}</select></label>
    <label>Sıralama<select value={sort} onChange={event => location.assign(href({ sort: event.target.value }))}><option value="mixed">Karışık</option><option value="popular">En bilinen</option><option value="newest">En yeni</option><option value="title">Ada göre (A–Z)</option></select></label>
    {(genre || initialQuery || params.get('year') || sort !== 'mixed') && <a className="text-link" href={base + 'catalog'}>Filtreleri temizle</a>}   </div>
   {request.loading && !request.data && <div className="film-leaves" role="status" aria-label="Diziler yükleniyor">{Array.from({ length: 6 }, (_, i) => <div className="film-leaf film-leaf-skeleton" key={i}/>)}</div>}
   {request.error && <Status error={request.error} retry={() => { request.retry(); genres.retry() }}/>}
   {request.data && <>{!request.data.items.length ? <div className="catalog-state"><h3>Bu aramada dizi bulunamadı.</h3><a href={base + 'catalog'}>Filtreleri temizle ↗</a></div> : <div className="film-leaves" aria-busy={request.loading} style={request.loading ? { opacity: .55, transition: "opacity .15s" } : undefined}>{request.data.items.map((movie, index) => <article className="film-leaf" key={movie.id}>
     <div className="film-leaf-body">
      <a className="film-leaf-cover" href={base + 'movie/' + movie.id} aria-label={movie.title + ' detaylarını görüntüle'}><Poster movie={movie}/></a>
      <div className="film-leaf-copy">
       {movie.year && <p className="film-leaf-year">{movie.year}</p>}
       <h2><a href={base + 'movie/' + movie.id}>{movie.title}</a></h2>
       {movie.originalTitle && movie.originalTitle !== movie.title && <p className="film-leaf-original">{movie.originalTitle}</p>}
       <p className="film-leaf-director">{movie.director ?? 'Yaratıcı bilgisi bulunmuyor'}</p>
      </div>
     </div>
     <CatalogWatchActions id={movie.id} title={movie.title} actions={watch}/>
     <p className="film-leaf-number" aria-hidden="true">— {(request.data!.page - 1) * 20 + index + 1} —</p>
    </article>)}</div>}
    {request.data.totalPages > 1 && <nav className="pagination catalog-pagination" aria-label="Katalog sayfaları">
     {request.data.page > 1 ? <a className="page-step" href={pageLink(request.data.page - 1)}><span aria-hidden="true">←</span> Önceki</a> : <span className="page-step" aria-disabled="true"><span aria-hidden="true">←</span> Önceki</span>}
     <span className="page-count">Sayfa <strong>{request.data.page}</strong> / {request.data.totalPages}</span>
     {request.data.page < request.data.totalPages ? <a className="page-step" href={pageLink(request.data.page + 1)}>Sonraki <span aria-hidden="true">→</span></a> : <span className="page-step" aria-disabled="true">Sonraki <span aria-hidden="true">→</span></span>}
    </nav>}</>}
  </section>
 </>
}
function MovieDetail({ id }: { id: string }) {
 const result = useData<FilmDetailData>('/api/series/' + id)
 return <>{result.loading && <section className="film-detail"><p role="status">Dizi yükleniyor…</p></section>}{result.error && <section className="film-detail"><Status error={result.error} retry={result.retry}/></section>}{result.data && <FilmDetail id={Number(id)} data={result.data}/>}</>
}
/** Header sign-out, right of the profile avatar; the session is shared with every Favo app. */
function SignOutButton({ account }: { account: ReturnType<typeof useSession> }) {
 const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false)
 async function signOut() { setBusy(true); setFailed(false); try { await account.logout() } catch { setFailed(true) } finally { setBusy(false) } }
 return <button type="button" className="nav-signout" disabled={busy} onClick={() => void signOut()} title={failed ? 'Çıkış tamamlanamadı. Tekrar dene.' : undefined} aria-live="polite">{busy ? 'Çıkılıyor…' : failed ? 'Tekrar dene' : 'Çıkış Yap'}</button>
}
/** Guest landing: the promise, sign-in and a wall of what is showing now. */
function Welcome() {
 const { account } = useCommunity()
 const popular = useData<Page>('/api/series/?sort=popular')
 const posters = popular.data?.items.slice(0, 8) ?? []
 return <section className="welcome-film">
  <div><p className="kicker"><span /> FAVO DİZİ</p><h1>Son bölüm bitsin,<span>etkisi bitmesin.</span></h1>
   <p className="lede">İzlediğin dizileri kaydet, yedi ölçütle değerlendir; sana göre yenilerini ve arkadaşlarının dizi gündemini keşfet.</p>
   <div className="welcome-actions"><AccountDialog account={account}/><a className="outline-button" href={registerUrl}>Favo hesabı aç ↗</a></div>
   <a className="welcome-browse" href={base + 'catalog'}>Kataloğa göz at →</a></div>
  {posters.length >= 4 ? <div className="poster-wall" aria-label="Gündemdeki diziler">{posters.map(movie => <a key={movie.id} href={base + 'movie/' + movie.id} aria-label={movie.title} title={movie.title}><Poster movie={movie}/></a>)}</div>
   : <div className="cinema-art" aria-hidden="true"><div className="screen"><span>F</span><small>THE NEXT SCENE IS YOURS</small></div><div className="seats"><i/><i/><i/><i/><i/></div><span className="frame-number">01 / SİNEMA</span></div>}
 </section>
}
function Home() {
 const { account } = useCommunity()
 if (account.initializing) return <p className="muted" role="status">Ekran hazırlanıyor…</p>
 return account.session ? <FilmHome/> : <Welcome/>
}
export default function App() {
 const account = useSession()
 const path = location.pathname.slice(base.length).replace(/\/$/, '')
 // A shared link (?ref=<nickname>&src=...) credits a later sign-up to the viewer who shared it.
 useEffect(() => { if (!account.initializing && !account.session) captureInviteFromUrl(location.search) }, [account.initializing, account.session])
 // An ad or campaign link (?utm_source=...) counts as an arrival; a later sign-up carries the campaign.
 useEffect(() => { captureCampaign(location.search, 'dizi') }, [])
 const detail = /^movie\/([1-9]\d*)\/?$/.exec(path)
 return <CommunityProvider key={account.session?.userId ?? 'guest'} account={account}><MarginReels/><a className="skip-link" href="#main">İçeriğe geç</a><header className="site-header"><a href={base} className="brand" aria-label="Favo Dizi ana sayfa"><span className="brand-mark"/><strong>favo</strong><span className="brand-label">Dizi</span></a><HeaderSearch/><nav aria-label="Ana gezinme"><a href="/">← Favo</a><a href={base} aria-current={path === '' ? 'page' : undefined}>Ana Sayfa</a><a href={base + 'catalog'} aria-current={path === 'catalog' ? 'page' : undefined}>Katalog</a><NicknameLink/><ProfileLink/>{account.session ? <SignOutButton account={account}/> : <AccountDialog account={account}/>}</nav></header><main id="main">{detail ? <MovieDetail id={detail[1]}/> : path === 'people' ? <People/> : /^people\/[a-zA-Z0-9_]{2,24}$/.test(path) ? <PublicProfile nickname={path.split('/')[1]}/> : path === 'catalog' ? <Catalog/> : path === 'profile' ? <FilmProfile/> : path === 'ozet' ? <SummaryPage/> : path === 'baslangic' ? <Onboarding/> : path === '' || path === 'index.html' ? <Home/> : <section className="catalog-state"><h1>Bu bölüm bulunamadı.</h1><a href={base}>Dizilere dön ↗</a></section>}</main><footer><span>© {new Date().getFullYear()} Favo Dizi</span></footer>{account.session && <Celebration/>}</CommunityProvider>
}

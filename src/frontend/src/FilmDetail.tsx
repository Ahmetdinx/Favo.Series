import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import AccountDialog from './auth/AccountDialog'
import { criteria, ErrorBox, FilmCover, useCommunity, useResource, type Entry, type Film } from './Community'
import { shareIcon } from './Journey'
import ShareSheet from './ShareSheet'
import { ShowcasePicks } from './Showcase'
import { profileUrl, renderFilmCard, type CardFormat } from './share'
import { mainStates, watchLabel as stateLabel, watchStates } from './watch'
import './film-detail.css'

const base = import.meta.env.BASE_URL
type Genre = { id: number; name: string }
export type FilmDetailData = { movie: Film; description: string | null; runtime: number | null; genres: Genre[]; directors: string[]; cast: string[]; countries: string[]; imdbUrl: string | null; wikidataUrl: string; endYear?: number | null; seasons?: number | null; episodes?: number | null; networks?: string[] }
/** "2008–2013" for a finished series, "2019–" while it still airs. */
export const airYears = (start: number | null | undefined, end: number | null | undefined) => start ? (end && end !== start ? start + '–' + end : end === start ? String(start) : start + '–') : null
type RatingSummary = { ratingCount: number; averageScore: number | null; criteriaAverages: Record<string, number> }

const hints: Record<string, string> = {
 theme: 'Hikâyenin fikri ve söylediği şey', visuals: 'Görüntü, ışık ve kamera dili', characters: 'Oyunculuklar ve karakterlerin inandırıcılığı',
 structure: 'Senaryo, kurgu ve yapı', pace: 'Dizinin seni ne kadar içine çektiği', impact: 'Bıraktığı duygu ve düşünce', experience: 'Bütün olarak izleme deneyimi'
}
const scale = Array.from({ length: 10 }, (_, i) => i + 1)
const format = (value: number) => value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
function overall(scores: Record<string, number>) {
 const keys = Object.keys(criteria)
 if (!keys.every(k => scores[k] >= 1)) return null
 return keys.reduce((sum, k) => sum + scores[k] * (k === 'pace' ? 10 : 15), 0) / 100
}

/** Film detail, laid out like the Books detail page: the cover and story spread, the rating card, then the credits. */
export function FilmDetail({ id, data }: { id: number; data: FilmDetailData }) {
 const { account, api, reload } = useCommunity()
 const own = useResource<{ entry: Entry | null }>(account.session ? '/api/series/community/entry/' + id : null)
 const [entry, setEntry] = useState<Entry | null>(null)
 const [summary, setSummary] = useState<RatingSummary | null>(null)
 const [summaryRevision, setSummaryRevision] = useState(0)
 useEffect(() => { setEntry(own.data?.entry ?? null) }, [own.data])
 useEffect(() => {
  const controller = new AbortController()
  void fetch('/api/series/community/ratings/' + id, { signal: controller.signal }).then(r => r.ok ? r.json() : null)
   .then(value => { if (!controller.signal.aborted) setSummary(value) }).catch(() => undefined)
  return () => controller.abort()
 }, [id, summaryRevision])

 async function write(state: string | null, scores: Record<string, number> | null) {
  if (state === null) await api('/api/series/community/entry/' + id, { method: 'DELETE' })
  else await api('/api/series/community/entry/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, scores }) })
  setEntry(state === null ? null : { movieId: id, state, scores, overall: scores ? overall(scores) : null })
  setSummaryRevision(v => v + 1)
  reload()
 }
 async function undo() {
  const result = await api<{ entry: Entry | null }>('/api/series/community/entry/' + id + '/undo', { method: 'POST' })
  setEntry(result.entry ? { ...result.entry, overall: result.entry.scores ? overall(result.entry.scores) : null } : null)
  setSummaryRevision(v => v + 1)
  reload()
 }

 const movie = data.movie
 const director = data.directors.join(', ')
 const facts = [airYears(movie.year, data.endYear), data.seasons && data.seasons + ' sezon', data.runtime && 'bölüm ' + data.runtime + ' dk', data.countries.join(', ')].filter(Boolean)
 const signedIn = !!account.session
 return <section className="film-detail">
  <a className="film-detail-back" href={base + 'catalog'}>← Katalog</a>
  <div className="film-spread">
   <div className="film-spread-cover"><div className="film-spread-poster"><FilmCover movie={movie}/></div></div>
   <div className="film-spread-copy">
    <h1>{movie.title}</h1>
    {movie.originalTitle && movie.originalTitle !== movie.title && <p className="film-spread-original">{movie.originalTitle}</p>}
    {director && <p className="film-spread-director">{director}</p>}
    <p className="film-spread-facts">{facts.join(' · ')}{data.genres.map(g => <a key={g.id} href={base + 'catalog?genre=' + g.id}>{g.name}</a>)}</p>
    <p className="film-spread-summary">{data.description || 'Bu dizinin Favo özeti henüz yazılmadı.'}</p>
    <WatchStatus signedIn={signedIn} loading={own.loading} error={own.error} entry={entry} write={write} undo={undo}/>
    {signedIn && <ShowcasePicks id={id}/>}
    {entry && <ShareFilm data={data} entry={entry}/>}
   </div>
  </div>
  <FilmRating id={id} signedIn={signedIn} entry={entry} summary={summary} ready={!signedIn || !!own.data} write={write}/>
  <section className="film-credits" aria-labelledby="film-credits-heading">
   <h2 id="film-credits-heading">Künye</h2>
   <div className="film-credit-cards">
    <article className="film-credit-card"><h3>Dizi hakkında</h3><dl>
     {[['Yaratıcı', director], ['Yayın', airYears(movie.year, data.endYear)], ['Sezon', data.seasons], ['Bölüm', data.episodes], ['Bölüm süresi', data.runtime && data.runtime + ' dakika'], ['Kanal', data.networks?.join(', ')], ['Ülke', data.countries.join(', ')], ['Tür', data.genres.map(g => g.name).join(', ')]]
      .filter(([, value]) => value).map(([label, value]) => <div key={label as string}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl><p className="film-credit-links">{data.imdbUrl && <a href={data.imdbUrl} target="_blank" rel="noopener noreferrer">IMDb ↗</a>}<a href={data.wikidataUrl} target="_blank" rel="noopener noreferrer">Künye kaynağı ↗</a></p></article>
    {data.cast.length > 0 && <article className="film-credit-card"><h3>Oyuncular</h3><ul className="film-cast">{data.cast.map((person, i) => <li key={person + i}><span aria-hidden="true">{person.charAt(0)}</span>{person}</li>)}</ul></article>}
   </div>
  </section>
 </section>
}

type Write = (state: string | null, scores: Record<string, number> | null) => Promise<void>

/** One tap stores the film in the archive; no separate "add to profile" step. */
function WatchStatus({ signedIn, loading, error, entry, write, undo }: { signedIn: boolean; loading: boolean; error: string; entry: Entry | null; write: Write; undo: () => Promise<void> }) {
 const { account } = useCommunity()
 const [busy, setBusy] = useState(false), [failure, setFailure] = useState(''), [message, setMessage] = useState(''), [canUndo, setCanUndo] = useState(false)
 if (!signedIn) return <div className="watch-status"><p className="watch-status-note">İzlediklerini arşivinde tutmak için giriş yap.</p><AccountDialog account={account}/></div>
 async function choose(state: string | null) {
  setBusy(true); setFailure(''); setMessage('')
  const hadScores = !!entry?.scores && state !== 'watched'
  try { await write(state, state === 'watched' ? entry?.scores ?? null : null); setCanUndo(true); setMessage(state === null ? 'Arşivinden kaldırıldı.' : hadScores ? 'Durum güncellendi; puanların kaldırıldı.' : entry ? 'Durum güncellendi.' : 'Arşivine eklendi.') }
  catch (e) { setFailure((e as Error).message) } finally { setBusy(false) }
 }
 async function revert() {
  setBusy(true); setFailure('')
  try { await undo(); setCanUndo(false); setMessage('Değişiklik geri alındı.') }
  catch (e) { setFailure((e as Error).message) } finally { setBusy(false) }
 }
 return <div className="watch-status">
  <p className="watch-status-note">{loading ? 'Yükleniyor…' : entry ? 'Arşivinde · ' + stateLabel[entry.state] : 'Henüz arşivinde değil'}</p>
  <div className="watch-status-options" role="group" aria-label="İzleme durumu">
   {watchStates.map(([key, label]) => <button key={key} type="button" className={'watch-pill' + (mainStates.some(([k]) => k === key) ? '' : ' quiet')} aria-pressed={entry?.state === key} disabled={busy || loading} onClick={() => void choose(entry?.state === key ? null : key)} title={entry?.state === key ? 'Tekrar tıklarsan arşivden kalkar' : undefined}>{label}</button>)}
  </div>
  <ErrorBox message={error || failure}/>{message && <p className="watch-status-message" role="status">{message}{canUndo && <button type="button" className="film-link-button" disabled={busy} onClick={() => void revert()}>Geri al</button>}</p>}
 </div>
}

/** Seven quiet rows of ten steps, as on the Books rating card. Saving a rating also marks the film as watched. */
function FilmRating({ id, signedIn, entry, summary, ready, write }: { id: number; signedIn: boolean; entry: Entry | null; summary: RatingSummary | null; ready: boolean; write: Write }) {
 const { account } = useCommunity()
 const panel = useRef<HTMLElement>(null)
 const [draft, setDraft] = useState<Record<string, number>>({})
 const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
 const [hasDraft, setHasDraft] = useState(false), [draftNotice, setDraftNotice] = useState('')
 const draftKey = account.session ? 'favo-dizi:rating-draft:' + account.session.userId + ':' + id : null
 useEffect(() => {
  if (!ready) return
  const stored = draftKey ? readDraft(draftKey) : null
  setDraft(stored ?? entry?.scores ?? {}); setHasDraft(!!stored); setDraftNotice(stored ? 'Yarım kalan taslağın açıldı.' : '')
 }, [entry?.scores, draftKey, ready])
 function changeDraft(next: Record<string, number>) {
  setDraft(next); setMessage('')
  const saved = !!draftKey && writeDraft(draftKey, next)
  setHasDraft(true); setDraftNotice(saved ? 'Taslak bu tarayıcıda saklandı.' : 'Taslak saklanamadı.')
 }
 function clearDraft() { if (draftKey) writeDraft(draftKey, null); setHasDraft(false); setDraftNotice('') }
 useEffect(() => { if (ready && location.hash === '#degerlendir') panel.current?.scrollIntoView({ block: 'start' }) }, [ready])
 const preview = overall(draft)
 const filled = Object.keys(criteria).filter(k => draft[k]).length
 const hasRating = !!entry?.scores
 async function save(e: FormEvent) {
  e.preventDefault(); if (!preview) return
  setBusy(true); setError(''); setMessage('')
  try { await write('watched', draft); clearDraft(); setMessage(hasRating ? 'Değerlendirmen güncellendi.' : 'Değerlendirmen kaydedildi; dizi İzledim olarak işaretlendi.') }
  catch (failure) { setError((failure as Error).message) } finally { setBusy(false) }
 }
 async function remove() {
  setBusy(true); setError(''); setMessage('')
  try { await write('watched', null); clearDraft(); setDraft({}); setMessage('Değerlendirmen kaldırıldı.') }
  catch (failure) { setError((failure as Error).message) } finally { setBusy(false) }
 }
 return <section ref={panel} id="degerlendir" className="film-rating" aria-labelledby="film-rating-title">
  <header className="film-rating-header"><h2 id="film-rating-title">Değerlendirme</h2>
   {summary && <p className="film-rating-community">{summary.averageScore == null ? <span>Henüz izleyici puanı yok</span> : <><strong>{format(summary.averageScore)}</strong><span> / 10 · {summary.ratingCount} izleyici</span></>}</p>}
  </header>
  {summary && summary.ratingCount > 0 && <details className="film-rating-averages"><summary>İzleyici ortalamaları</summary><dl>
   {Object.entries(criteria).map(([key, label]) => <div key={key}><dt>{label}</dt><dd><span className="film-average-bar" aria-hidden="true"><span style={{ width: (summary.criteriaAverages[key] ?? 0) * 10 + '%' }}/></span><span>{summary.criteriaAverages[key] == null ? '—' : format(summary.criteriaAverages[key])}</span></dd></div>)}
  </dl></details>}
  {!signedIn ? <div className="film-rating-guest"><p>Giriş yap, diziyi yedi ölçütle puanla.</p><AccountDialog account={account}/></div> :
   <form onSubmit={e => void save(e)}><fieldset disabled={busy || !ready}><legend className="sr-only">{hasRating ? 'Değerlendirmeni güncelle' : 'Diziyi yedi ölçütle puanla'}</legend>
    <div className="film-rating-rows">
     {Object.entries(criteria).map(([key, label]) => <div className="film-rating-row" key={key} role="radiogroup" aria-labelledby={'film-rating-' + key}>
      <span className="film-rating-label" id={'film-rating-' + key} title={hints[key] + (key === 'pace' ? ' (ağırlık %10)' : ' (ağırlık %15)')}>{label}</span>
      <span className="film-rating-scale">{scale.map(score => <label key={score} className={draft[key] && score <= draft[key] ? 'filled' : undefined} title={String(score)}>
       <input type="radio" name={'film-rating-' + key} value={score} required checked={draft[key] === score} aria-label={label + ' ' + score} onChange={() => changeDraft({ ...draft, [key]: score })}/><span aria-hidden="true"/>
      </label>)}</span>
      <span className="film-rating-value" aria-hidden="true">{draft[key] ?? ''}</span>
     </div>)}
    </div>
    <div className="film-rating-footer">
     <div className="film-rating-overall" role="status"><strong>{preview == null ? filled + '/7' : format(preview)}</strong><span>{preview == null ? 'ölçüt puanlandı' : 'genel puanın'}</span></div>
     {draftNotice && <p className="film-rating-draft">{draftNotice}</p>}
     <div className="film-rating-actions">
      {hasDraft && <button type="button" className="film-link-button" onClick={() => { clearDraft(); setDraft(entry?.scores ?? {}) }}>Taslağı sil</button>}
      {hasRating && <button type="button" className="film-link-button" onClick={() => void remove()}>Kaldır</button>}
      <button className="primary" disabled={preview == null || busy}>{busy ? 'Kaydediliyor…' : hasRating ? 'Güncelle' : 'Kaydet'}</button>
     </div>
    </div>
   </fieldset></form>}
  <ErrorBox message={error}/>{message && <p className="film-rating-message" role="status">{message}</p>}
 </section>
}

/** "Share" on a film page, as on Books: a rating card once rated, otherwise a "watched" or "now watching" card. */
function ShareFilm({ data, entry }: { data: FilmDetailData; entry: Entry }) {
 const { me } = useCommunity()
 const [open, setOpen] = useState(false)
 const kind = entry.overall != null ? 'rating' : entry.state === 'watched' ? 'watched' : entry.state === 'watching' ? 'watching' : null
 const nickname = me?.nickname ?? null, linkable = !!nickname && !!me?.isPublic
 const draw = useCallback((format: CardFormat) => renderFilmCard({ kind: kind ?? 'watching', film: { ...data.movie, director: data.directors[0] ?? data.movie.director }, score: entry.overall, summary: data.description }, nickname, format, linkable),
  [kind, data, entry.overall, nickname, linkable])
 if (!kind) return null
 const label = kind === 'rating' ? 'Puanını paylaş' : kind === 'watched' ? 'İzlediğini paylaş' : 'İzlediğin diziyi paylaş'
 const score = entry.overall?.toLocaleString('tr-TR', { maximumFractionDigits: 1 })
 return <>
  <button type="button" className="film-share-button film-detail-share" onClick={() => setOpen(true)}>{shareIcon}{label}</button>
  <ShareSheet open={open} onClose={() => setOpen(false)} title={label} alt={`${data.movie.title} kartı`} render={draw} fileName="favo-dizi.png"
   shareText={kind === 'rating' ? `«${data.movie.title}» için puanım ${score}/10.` : kind === 'watched' ? `«${data.movie.title}» izledim.` : `Şu an «${data.movie.title}» izliyorum.`}
   link={linkable ? profileUrl(nickname!, 'kart') : null} note={linkable ? 'Kartta profil adresin yazar.' : 'Profilin gizli olduğu için kartta yalnızca Favo adresi yazar.'}/>
 </>
}

/** Rating drafts live in this browser only; storage may be unavailable (private mode), so every access is guarded. */
function readDraft(key: string): Record<string, number> | null {
 try { const value = JSON.parse(localStorage.getItem(key) ?? 'null'); return value && typeof value === 'object' ? value : null } catch { return null }
}
function writeDraft(key: string, value: Record<string, number> | null) {
 try { if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key); return true } catch { return false }
}

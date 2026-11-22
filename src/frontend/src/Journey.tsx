import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ErrorBox, MiniPoster, useCommunity, useResource, type Film } from './Community'
import ShareSheet from './ShareSheet'
import { profileUrl, renderIdentityCard, renderSummaryCard, type CardFormat } from './share'
import './journey.css'

const base = import.meta.env.BASE_URL

type Badge = { threshold: number; title: string }
export type Track = { kind: string; label: string; count: number; current: Badge | null; next: Badge | null; remaining: number; progressPercent: number; badges: Badge[] }
export type Taste = { ready: boolean; watchedCount: number; ratingCount: number; filmsNeeded: number; ratingsNeeded: number; title: string | null;
  genres: { id: number; name: string; percent: number }[]; strengths: { key: string; label: string }[]; traits: string[]; averageScore: number | null; signature: Film | null }
export type Journey = { achievements: Track[]; taste: Taste }
type SummaryFilm = { movie: Film; directors: string[]; runtime: number | null; watchedAtUtc: string; score: number | null }
type Summary = { year: number; month: number | null; availableYears: number[]; filmCount: number; minutes: number; previousFilmCount: number;
  months: { month: number; count: number }[]; genres: { id: number; name: string; count: number }[]; topDirector: { name: string; count: number } | null;
  averageScore: number | null; favorite: SummaryFilm | null; longest: SummaryFilm | null; films: SummaryFilm[] }

export const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
const decimal = (value: number) => value.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const duration = (minutes: number) => minutes >= 60 ? { value: Math.round(minutes / 60).toLocaleString('tr-TR'), unit: 'saat' } : { value: String(minutes), unit: 'dakika' }

/* ---------- Badges and viewer identity ---------- */

export function Popover({ label, trigger, children }: { label: string; trigger: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const close = (event: Event) => { if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', close)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close) }
  }, [open])
  return <div className="journey-pop" ref={root}>
    <button type="button" className="journey-chip" aria-expanded={open} aria-controls={id} aria-label={label} onClick={() => setOpen(o => !o)}>{trigger}</button>
    {open && <div className="journey-pop-panel" id={id} role="dialog" aria-label={label}>{children}</div>}
  </div>
}

/** Film reel for watching, a star for evaluating; the ring colour climbs with the earned tier. */
export function BadgeEmblem({ track }: { track: Track }) {
  const tier = track.current ? track.badges.findIndex(b => b.threshold === track.current!.threshold) + 1 : 0
  return <span className={`badge-emblem tier-${tier}`} aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {track.kind === 'watching'
        ? <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="7" r="1.8" /><circle cx="12" cy="17" r="1.8" /><circle cx="7" cy="12" r="1.8" /><circle cx="17" cy="12" r="1.8" /></>
        : <path d="m12 3.5 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />}
    </svg>
  </span>
}

const emptyBadge = (track: Track, own: boolean) => !own ? 'Henüz rozet yok' : track.kind === 'watching' ? 'İlk dizisini bekliyor' : 'İlk değerlendirmeni bekliyor'

export function AchievementCard({ track, own }: { track: Track; own: boolean }) {
  return <div className="achievement-card">
    <header><BadgeEmblem track={track} /><div><small>{track.label} rozeti</small><strong>{track.current?.title ?? emptyBadge(track, own)}</strong></div></header>
    <p className="achievement-count"><b>{track.count.toLocaleString('tr-TR')}</b> {track.kind === 'watching' ? 'dizi izlendi' : 'dizi değerlendirildi'}</p>
    {track.next
      ? <><div className="achievement-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={track.progressPercent} aria-label={`${track.next.title} rozetine ilerleme`}><span style={{ width: `${Math.max(4, track.progressPercent)}%` }} /></div>
        <p className="achievement-next">{track.next.title} rozetine <b>{track.remaining}</b> dizi kaldı</p></>
      : <p className="achievement-next">Tüm {track.label.toLocaleLowerCase('tr-TR')} rozetleri kazanıldı.</p>}
    <ol className="achievement-milestones">{track.badges.map(b => <li key={b.threshold} className={track.count >= b.threshold ? 'earned' : undefined}><span>{b.threshold.toLocaleString('tr-TR')}</span>{b.title}</li>)}</ol>
  </div>
}

const stripColors = ['#33668a', '#4ab5b9', '#44606a', '#4a737a']

/** The viewer identity as a cinema admission ticket: velvet header, genres as frames on a film strip, stamped traits. */
export function TasteCard({ taste, own, onShare }: { taste: Taste; own: boolean; onShare?: () => void }) {
  if (!taste.ready) return <article className="film-pass film-pass-waiting" aria-labelledby="film-pass-heading">
    <header className="film-pass-head"><p className="film-pass-kicker">{own ? 'İzleyici kimliğin' : 'İzleyici kimliği'}</p><h2 id="film-pass-heading">Hazırlanıyor</h2></header>
    <div className="film-pass-tear" aria-hidden="true" />
    <div className="film-pass-body"><p className="film-pass-hint">{own ? `Kimliğin ${taste.filmsNeeded} dizi daha izlediğinde ya da ${taste.ratingsNeeded} dizi daha değerlendirdiğinde ortaya çıkar.` : 'Bu izleyicinin kimliği henüz şekillenmedi.'}</p>
      {own && <a className="film-pass-link" href={base + 'catalog'}>Kataloğa git ↗</a>}</div>
  </article>
  return <article className="film-pass" aria-labelledby="film-pass-heading">
    <header className="film-pass-head">
      <div className="film-pass-top"><p className="film-pass-kicker">{own ? 'İzleyici kimliğin' : 'İzleyici kimliği'}</p>
        <span className="film-pass-number" aria-hidden="true">№ {String(taste.watchedCount + taste.ratingCount).padStart(3, '0')}</span></div>
      <h2 id="film-pass-heading">{taste.title}</h2>
      <p className="film-pass-admit" aria-hidden="true">Tek kişilik giriş · Favo Dizi</p>
    </header>
    <div className="film-pass-tear" aria-hidden="true" />
    <div className="film-pass-body">
      {taste.genres.length > 0 && <>
        <div className="film-pass-strip" aria-hidden="true">{taste.genres.map((g, i) => <span key={g.id} style={{ flexGrow: Math.max(g.percent, 6), backgroundColor: stripColors[i % stripColors.length] }} />)}</div>
        <ul className="film-pass-legend" aria-label="En çok izlenen türler">{taste.genres.map((g, i) => <li key={g.id}>
          <i style={{ background: stripColors[i % stripColors.length] }} aria-hidden="true" /><span>{g.name}</span><strong>%{g.percent}</strong></li>)}</ul>
      </>}
      {taste.strengths.length > 0 && <p className="film-pass-strengths">{own ? 'Sevdiğin' : 'Sevdiği'} dizilerde öne çıkan <strong>{taste.strengths.map(s => s.label).join(' ve ')}</strong></p>}
      {own && taste.strengths.length === 0 && taste.ratingsNeeded > 0 && <p className="film-pass-hint film-pass-rule">{taste.ratingsNeeded} değerlendirme daha yaparsan, sevdiğin filmlerde nelerin öne çıktığı da burada görünür.</p>}
      {taste.traits.length > 0 && <ul className="film-pass-stamps" aria-label="İzleyici özellikleri">{taste.traits.map(t => <li key={t}>{t}</li>)}</ul>}
      {taste.signature && <a className="film-pass-signature" href={base + 'movie/' + taste.signature.id}><span className="film-pass-poster"><MiniPoster movie={taste.signature} /></span><span><small>İmza dizisi</small>{taste.signature.title}</span></a>}
      <footer className="film-pass-foot">
        <p>{taste.watchedCount} izlenen · {taste.ratingCount} değerlendirme{taste.averageScore != null && ` · ort. ${decimal(taste.averageScore)}`}</p>
        {own && onShare && <button type="button" onClick={onShare}>Kimliğini paylaş</button>}
      </footer>
    </div>
  </article>
}

/** Identity, badges and (on the own profile) the summary link, as chips that open a card. */
export function JourneyChips({ journey, own, onShare, children }: { journey: Journey; own: boolean; onShare?: () => void; children?: ReactNode }) {
  return <div className="journey-chips">
    <Popover label="İzleyici kimliği" trigger={<>
      <span className="badge-emblem tier-id" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M3.5 9h17M8 5l-1.5 4M13 5l-1.5 4M18 5l-1.5 4" /></svg></span>
      <span className="chip-text"><small>İzleyici kimliği</small><b>{journey.taste.ready ? journey.taste.title : 'Hazırlanıyor'}</b></span></>}>
      <TasteCard taste={journey.taste} own={own} onShare={onShare} />
    </Popover>
    {journey.achievements.map(track => <Popover key={track.kind} label={track.label + ' rozetleri'} trigger={<>
      <BadgeEmblem track={track} /><span className="chip-text"><small>{track.label}</small><b>{track.current?.title ?? emptyBadge(track, own)}</b></span></>}>
      <AchievementCard track={track} own={own} />
    </Popover>)}
    {own && <a className="journey-chip" href={base + 'ozet'}>
      <span className="badge-emblem tier-id" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 20h16" /><rect x="5.5" y="11" width="3" height="6.5" rx=".6" /><rect x="10.5" y="6.5" width="3" height="11" rx=".6" /><rect x="15.5" y="9" width="3" height="8.5" rx=".6" /></svg></span>
      <span className="chip-text"><small>İzleme özetin</small><b>{today().year} yılın</b></span>
    </a>}
    {children}
  </div>
}

/* ---------- Monthly and yearly summary ---------- */

// Period boundaries follow Türkiye time (UTC+3), like the server.
function today() {
  const local = new Date(Date.now() + 3 * 3600_000)
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1 }
}
const periodLabel = (year: number, month: number | null) => month ? `${monthNames[month - 1]} ${year}` : String(year)

function comparison(s: Summary) {
  if (s.previousFilmCount === 0) return null
  const unit = s.month ? 'geçen aya' : 'geçen yıla', diff = s.filmCount - s.previousFilmCount
  return diff === 0 ? `${unit} göre aynı tempo` : `${unit} göre ${diff > 0 ? '+' : ''}${diff} dizi`
}

export function SummaryPage() {
  const { account, me } = useCommunity()
  const now = today()
  const initial = new URLSearchParams(location.search)
  const [year, setYear] = useState(Number(initial.get('yil')) || now.year)
  const [month, setMonth] = useState<number | null>(() => { const m = Number(initial.get('ay')); return m >= 1 && m <= 12 ? m : null })
  const [sharing, setSharing] = useState(false)
  const result = useResource<Summary>(account.session ? `/api/series/community/summary?year=${year}${month ? '&month=' + month : ''}` : null)
  const summary = result.data

  function select(nextYear: number, nextMonth: number | null) {
    setYear(nextYear); setMonth(nextMonth)
    const params = new URLSearchParams({ yil: String(nextYear) }); if (nextMonth) params.set('ay', String(nextMonth))
    history.replaceState(null, '', base + 'ozet?' + params)
  }
  const busiest = useMemo(() => summary?.months.reduce((best, m) => m.count > best.count ? m : best, { month: 0, count: 0 }), [summary])
  const maxMonth = Math.max(1, ...(summary?.months.map(m => m.count) ?? [0]))
  const lastMonth = year === now.year ? now.month : 12
  const label = periodLabel(year, month)
  let chapter = 0
  const next = () => String(++chapter).padStart(2, '0')

  if (account.initializing) return <p role="status">Özet yükleniyor…</p>
  if (!account.session) return <section className="profile-gate"><h1>İzleme özetin<em>.</em></h1><p>Özetini görmek için giriş yap.</p></section>

  return <section className="film-summary">
    <a className="back-link" href={base + 'profile'}>← Dizi profilim</a>
    <div className="summary-controls" role="group" aria-label="Dönem seçimi">
      <div className="summary-toggle">
        <button type="button" aria-pressed={!month} onClick={() => select(year, null)}>Yıllık</button>
        <button type="button" aria-pressed={!!month} onClick={() => select(year, year === now.year ? now.month : 12)}>Aylık</button>
      </div>
      <label><span className="sr-only">Yıl</span><select value={year} onChange={e => { const y = Number(e.target.value); select(y, month && y === now.year ? Math.min(month, now.month) : month) }}>
        {(summary?.availableYears ?? [now.year]).map(y => <option key={y} value={y}>{y}</option>)}</select></label>
      {month && <label><span className="sr-only">Ay</span><select value={month} onChange={e => select(year, Number(e.target.value))}>
        {monthNames.slice(0, lastMonth).map((name, i) => <option key={name} value={i + 1}>{name}</option>)}</select></label>}
    </div>
    <ErrorBox message={result.error} retry={result.retry} />
    {result.loading && <p className="muted" role="status">Diziler sayılıyor…</p>}

    {summary && summary.filmCount === 0 && <div className="summary-poster summary-empty">
      <p className="kicker">{label} · izleme özetin</p>
      <h1>Ekran henüz kapalı.</h1>
      <p className="summary-lede">Bir diziyi “İzledim” olarak işaretlediğinde {month ? 'bu ayın' : 'bu yılın'} özeti burada kendiliğinden yazılır.</p>
      <a className="primary" href={base + 'catalog'}>Dizi keşfet ↗</a>
    </div>}

    {summary && summary.filmCount > 0 && <>
      <div className="summary-poster">
        <div className="summary-copy">
          <p className="kicker">{month ? label : `${year} yılın`}{me?.nickname ? ` · @${me.nickname}` : ''}</p>
          <h1 className="summary-count"><b>{summary.filmCount}</b><span>dizi izledin</span></h1>
          {summary.genres[0] && <p className="summary-lede">{month ? 'Bu ay' : 'Bu yıl'} en çok <em>{summary.genres[0].name.toLocaleLowerCase('tr-TR')}</em> izledin
            {summary.topDirector && <>, en sık <em>{summary.topDirector.name}</em> dizileriyle buluştun</>}.</p>}
          <dl className="summary-stats">
            {summary.minutes > 0 && <div><dt>{duration(summary.minutes).unit} ekran</dt><dd>{duration(summary.minutes).value}</dd></div>}
            {summary.averageScore != null && <div><dt>ortalama puan</dt><dd>{decimal(summary.averageScore)}</dd></div>}
            {summary.genres.length > 0 && <div><dt>tür</dt><dd>{summary.genres.length}</dd></div>}
          </dl>
          {comparison(summary) && <p className="summary-compare">{comparison(summary)}</p>}
          <button type="button" className="summary-share" onClick={() => setSharing(true)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg>Özetini paylaş</button>
        </div>
        <div className="summary-fan" aria-hidden="true">
          {heroFilms(summary).map((film, i, all) => <span key={film.movie.id} style={{ '--i': i - (all.length - 1) / 2 } as CSSProperties}><MiniPoster movie={film.movie} /></span>)}
        </div>
        <span className="summary-perforation" aria-hidden="true" />
      </div>

      {!month && <section className="summary-chapter" aria-labelledby="summary-months">
        <header><span>{next()}</span><h2 id="summary-months">Aylara göre</h2></header>
        <ol className="summary-months">{summary.months.map(m => <li key={m.month}>
          <button type="button" disabled={year === now.year && m.month > now.month} onClick={() => select(year, m.month)}
            aria-current={busiest && busiest.count > 0 && m.month === busiest.month ? 'true' : undefined} aria-label={`${monthNames[m.month - 1]}: ${m.count} dizi`}>
            <span className="bar-count">{m.count || ''}</span><span className="bar"><span style={{ height: `${(m.count / maxMonth) * 100}%` }} /></span><span className="bar-month">{monthNames[m.month - 1].slice(0, 3)}</span>
          </button></li>)}</ol>
        {busiest && busiest.count > 1 && <p className="summary-note">En dolu ayın <b>{monthNames[busiest.month - 1]}</b>: {busiest.count} dizi.</p>}
      </section>}

      {summary.genres.length > 0 && <section className="summary-chapter" aria-labelledby="summary-genres">
        <header><span>{next()}</span><h2 id="summary-genres">En çok izlediğin türler</h2></header>
        <ol className="summary-genres">{summary.genres.map((g, i) => <li key={g.id} className={i === 0 ? 'lead' : undefined}>
          <span>{g.name}</span><i style={{ '--share': `${(g.count / summary.genres[0].count) * 100}%` } as CSSProperties} /><b>{g.count}</b></li>)}</ol>
      </section>}

      {(summary.favorite || summary.longest || summary.topDirector) && <section className="summary-chapter" aria-labelledby="summary-highlights">
        <header><span>{next()}</span><h2 id="summary-highlights">Öne çıkanlar</h2></header>
        <div className="summary-highlights">
          {summary.favorite && <Highlight label="En sevdiğin" film={summary.favorite} note={summary.favorite.score != null ? `★ ${decimal(summary.favorite.score)} / 10` : null} />}
          {summary.longest && summary.longest.movie.id !== summary.favorite?.movie.id && <Highlight label="En uzun seans" film={summary.longest} note={summary.longest.runtime ? `${summary.longest.runtime} dakika` : null} />}
          {summary.topDirector && <div className="summary-highlight director"><span><small>En çok izlediğin yaratıcı</small><strong>{summary.topDirector.name}</strong><em>{summary.topDirector.count} dizi</em></span></div>}
        </div>
      </section>}

      <section className="summary-chapter" aria-labelledby="summary-films">
        <header><span>{next()}</span><h2 id="summary-films">{label} dizi şeridin</h2></header>
        <ul className="summary-strip">{summary.films.map(film => <li key={film.movie.id}>
          <a href={base + 'movie/' + film.movie.id} aria-label={film.movie.title} title={film.movie.title}><MiniPoster movie={film.movie} /></a>
          <span>{new Date(film.watchedAtUtc).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', timeZone: 'Europe/Istanbul' })}{film.score != null && <b>★ {decimal(film.score)}</b>}</span>
        </li>)}</ul>
      </section>
      <ShareSummary summary={summary} nickname={me?.nickname ?? null} isPublic={!!me?.isPublic} open={sharing} onClose={() => setSharing(false)} />
    </>}
  </section>
}

/** The favourite first, then the latest films, without repeats. */
function heroFilms(s: Summary) {
  return [s.favorite, ...s.films].filter((f, i, all): f is SummaryFilm => !!f && all.findIndex(x => x?.movie.id === f.movie.id) === i).slice(0, 5)
}

function Highlight({ label, film, note }: { label: string; film: SummaryFilm; note: string | null }) {
  return <a className="summary-highlight" href={base + 'movie/' + film.movie.id}><span className="summary-highlight-cover"><MiniPoster movie={film.movie} /></span><span><small>{label}</small><strong>{film.movie.title}</strong>{note && <em>{note}</em>}</span></a>
}

/* ---------- Sharing ---------- */

export const shareIcon = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg>

function ShareSummary({ summary, nickname, isPublic, open, onClose }: { summary: Summary; nickname: string | null; isPublic: boolean; open: boolean; onClose: () => void }) {
  const label = periodLabel(summary.year, summary.month)
  const linkable = !!nickname && isPublic
  const draw = useCallback((format: CardFormat) => renderSummaryCard({
    label: summary.month ? label : String(summary.year), filmCount: summary.filmCount,
    hours: summary.minutes >= 60 ? Math.round(summary.minutes / 60).toLocaleString('tr-TR') : null, averageScore: summary.averageScore,
    genres: summary.genres.map(g => g.name), films: heroFilms(summary).map(f => ({ ...f.movie, director: f.directors[0] ?? f.movie.director })),
    favorite: summary.favorite ? { ...summary.favorite.movie, score: summary.favorite.score } : null,
  }, nickname, format, linkable), [summary, label, nickname, linkable])
  return <ShareSheet open={open} onClose={onClose} title="İzleme özetini paylaş" alt={`${label} izleme özeti: ${summary.filmCount} dizi`}
    render={draw} fileName={`favo-izleme-ozeti-${summary.year}${summary.month ? '-' + summary.month : ''}.png`}
    shareText={`${label} izleme özetim: ${summary.filmCount} dizi${summary.minutes >= 60 ? `, ${duration(summary.minutes).value} saat` : ''}.`}
    link={linkable ? profileUrl(nickname!, 'kart') : null}
    note={linkable ? 'Kartta profil adresin yazar.' : 'Profilin gizli olduğu için kartta yalnızca Favo adresi yazar.'} />
}

/** Share sheet for the viewer identity card, opened from the identity card and the referral chip. */
export function ShareIdentity({ taste, open, onClose }: { taste: Taste; open: boolean; onClose: () => void }) {
  const { me } = useCommunity()
  const nickname = me?.nickname ?? null, linkable = !!nickname && !!me?.isPublic
  const draw = useCallback((format: CardFormat) => renderIdentityCard(taste, nickname, format, linkable), [taste, nickname, linkable])
  return <ShareSheet open={open} onClose={onClose} title="İzleyici kimliğini paylaş" alt={`${taste.title ?? 'İzleyici kimliği'} kartı`}
    render={taste.ready ? draw : null} fileName="favo-izleyici-kimligi.png" shareText="İzleyici kimliğim Favo'da:" link={linkable ? profileUrl(nickname!, 'kart') : null}
    note={linkable ? 'Kartta profil adresin yazar; gören kişi seni bulabilir ve kendi izleyici kimliğini çıkarabilir.'
      : 'Profilin gizli olduğu için kartta yalnızca Favo adresi yazar. Profilini herkese açarsan kartı gören kişi doğrudan seni bulur.'} />
}

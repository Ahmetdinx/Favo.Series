import { useCallback, useState, type CSSProperties } from 'react'
import AccountDialog from './auth/AccountDialog'
import { AvatarPicker, CinemaAvatar, ErrorBox, MiniPoster, Preferences, ProfileSettings, RecommendationHistory, useCommunity, useResource, type FilmRow, type Network } from './Community'
import { JourneyChips, Popover, ShareIdentity, shareIcon, type Journey } from './Journey'
import ShareSheet from './ShareSheet'
import { watchLabel } from './watch'
import { pendingInvite, registerUrl, rememberInvite } from './invite'

// Ara verdim / Yarım bıraktım tabs appear only once something is on them.
const quietShelves = ['paused', 'dropped']
import { profileUrl, renderCompatibilityCard, type CardFormat } from './share'
import type { Film } from './Community'
import './profile.css'

import { OwnShowcase, ShowcaseShelf, type ShowcaseData } from './Showcase'
const base = import.meta.env.BASE_URL
type Member = { nickname: string; avatarId: string }

/** Own Film profile, laid out like "Kitaplığım": title, the viewer band, then the shelf. */
export function FilmProfile() {
  const { account, me, error, reload, loading } = useCommunity()
  if (account.initializing) return <p role="status">Profil yükleniyor…</p>
  if (!account.session) return <section className="profile-gate"><CinemaAvatar /><h1>Senin dizilerin<em>.</em></h1><p>Dizi profilini görmek için giriş yap.</p><AccountDialog account={account} /></section>
  return <section className="film-profile-page">
    <header className="room-header"><h1>Dizi arşivim</h1></header>
    <ErrorBox message={error} retry={reload} />
    {loading && !me && <p className="muted" role="status">Profil yükleniyor…</p>}
    {me && <><ViewerBand /><OwnShowcase /><FilmCase rows={me.entries} own /></>}
  </section>
}

const gear = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>

/** Who I am, my identity and badges (as popovers), my circle and my settings — the Film "Okur çevrem" band. */
function ViewerBand() {
  const { me, account, reload } = useCommunity()
  const [settingsOpen, setSettingsOpen] = useState(!me?.nickname)
  const [message, setMessage] = useState('')
  const [sharing, setSharing] = useState(false)
  // Reload badges whenever the profile itself reloads (a new watch or rating).
  const journey = useResource<Journey>(me ? '/api/series/community/journey?v=' + me.entries.length + '-' + me.entries.filter(r => r.entry.scores).length : null)
  if (!me) return null
  async function copyLink() {
    try { await navigator.clipboard.writeText(profileUrl(me!.nickname!, 'link')); setMessage('Profil bağlantısı kopyalandı.') }
    catch { setMessage('Bağlantı kopyalanamadı.') }
  }
  return <section className="viewer-band" aria-labelledby="viewer-band-heading">
    <div className="viewer-band-top">
      <h2 id="viewer-band-heading" className="viewer-band-kicker">İzleyici çevrem</h2>
      <button type="button" className="band-settings" aria-expanded={settingsOpen} aria-controls="viewer-band-settings" onClick={() => setSettingsOpen(o => !o)}>{gear}Profil ayarları</button>
    </div>
    <div className="viewer-band-row">
      <div className="viewer-band-who">
        <AvatarPicker />
        <div>
          <p className="viewer-band-name">{me.nickname ? '@' + me.nickname : 'Kullanıcı adını seç'}</p>
          <p className="viewer-band-meta"><span>{me.isPublic ? 'Herkese açık' : 'Gizli profil'}</span>
            {me.nickname && me.isPublic && <><a href={base + 'people/' + encodeURIComponent(me.nickname)}>Profili gör</a><button type="button" onClick={() => void copyLink()}>Bağlantıyı kopyala</button></>}</p>
          {message && <p className="viewer-band-message" role="status">{message}</p>}
        </div>
      </div>
      {journey.data && <JourneyChips journey={journey.data} own onShare={journey.data.taste.ready ? () => setSharing(true) : undefined}><ReferralChip onShare={journey.data.taste.ready ? () => setSharing(true) : undefined} /></JourneyChips>}
      {journey.data?.taste.ready && <ShareIdentity taste={journey.data.taste} open={sharing} onClose={() => setSharing(false)} />}
      <Connections />
    </div>
    <ErrorBox message={journey.error} retry={journey.retry} />
    {settingsOpen && <div id="viewer-band-settings" className="viewer-band-settings">
      <ProfileSettings />
      <div className="viewer-band-settings-side">
        <Preferences initial={me.preferences} onSaved={reload} />
        <RecommendationHistory />
        <div className="viewer-band-account"><span>Oturum</span><AccountDialog account={account} /></div>
      </div>
    </div>}
  </section>
}

/** "Davetlerin": people who joined Favo through this viewer's shared links. */
function ReferralChip({ onShare }: { onShare?: () => void }) {
  const result = useResource<{ total: number; readers: Member[] }>('/api/series/community/referrals')
  if (!result.data) return null
  const { total, readers } = result.data
  return <Popover label="Seninle gelen izleyiciler" trigger={<>
    <span className="badge-emblem tier-id" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 19c1.5-4 4-5.5 6-5.5s4.5 1.5 6 5.5" /><circle cx="10" cy="8" r="3.2" /><path d="M16.5 5.5v5M14 8h5" /></svg></span>
    <span className="chip-text"><small>Davetlerin</small><b>{total ? `${total} izleyici` : 'Henüz yok'}</b></span></>}>
    <div className="referral-card">
      <h3>{total ? `${total} kişi seninle geldi` : 'Seninle gelen izleyiciler'}</h3>
      <p>{total ? 'Paylaştığın kart ya da bağlantıdan Favo\'ya katılanlar. Gizli profiller yalnızca sayıya dahil.' : 'Profil bağlantını ya da özet kartını paylaş; senin paylaşımınla katılanlar burada görünür.'}</p>
      {readers.length > 0 && <ul>{readers.map(r => <li key={r.nickname}><a href={base + 'people/' + encodeURIComponent(r.nickname)}><CinemaAvatar id={r.avatarId} /><span>@{r.nickname}</span></a></li>)}</ul>}
      {onShare && <button type="button" className="film-share-button referral-share" onClick={onShare}>{shareIcon}Kimliğini paylaş</button>}
    </div>
  </Popover>
}

/** Follower and following counts that open their list in place, as on the Kitap profile. */
function Connections() {
  const [kind, setKind] = useState<'followers' | 'following' | null>(null)
  const [page, setPage] = useState(1)
  const counts = useResource<Network>('/api/people/me/network')
  const list = useResource<{ items: Member[]; hasMore: boolean }>(kind ? `/api/series/community/directory?kind=${kind}&page=${page}` : null)
  function select(next: 'followers' | 'following') { setKind(kind === next ? null : next); setPage(1) }
  return <>
    <div className="social-counts">
      <button aria-expanded={kind === 'followers'} aria-controls="viewer-connection-list" onClick={() => select('followers')}><strong>{counts.data?.followerCount ?? '—'}</strong> takipçi</button>
      <button aria-expanded={kind === 'following'} aria-controls="viewer-connection-list" onClick={() => select('following')}><strong>{counts.data?.followingCount ?? '—'}</strong> takip</button>
    </div>
    <ErrorBox message={counts.error} retry={counts.retry} />
    {kind && <div id="viewer-connection-list" className="viewer-connection-list">
      <h3>{kind === 'followers' ? 'Takipçilerim' : 'Takip ettiklerim'}</h3>
      <ErrorBox message={list.error} retry={list.retry} />
      {list.loading && <p className="muted" role="status">Liste yükleniyor…</p>}
      {list.data && <>{!list.data.items.length ? <p className="muted">Henüz kimse yok.</p>
        : <ul>{list.data.items.map(m => <li key={m.nickname}><a href={base + 'people/' + encodeURIComponent(m.nickname)}><CinemaAvatar id={m.avatarId} /><span>@{m.nickname}</span><span aria-hidden="true">↗</span></a></li>)}</ul>}
        {(page > 1 || list.data.hasMore) && <nav className="social-pagination" aria-label="Kişi listesi sayfaları"><button disabled={page === 1} onClick={() => setPage(p => p - 1)}>Önceki</button><span>{page}</span><button disabled={!list.data.hasMore} onClick={() => setPage(p => p + 1)}>Sonraki</button></nav>}</>}
    </div>}
  </>
}

const pageSize = 24
const ribbons = watchLabel
const score = (value: number) => value.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** The film shelf: status tabs with counts, posters with a status ribbon and the viewer's own score. */
export function FilmCase({ rows, own }: { rows: FilmRow[]; own: boolean }) {
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const tabs: [string, string][] = own
    ? [['all', 'Tümü'], ['watchlist', 'İzleyeceklerim'], ['watching', 'İzliyorum'], ['watched', 'İzlediklerim'], ['paused', 'Ara verdiklerim'], ['dropped', 'Yarım bıraktıklarım']]
    : [['all', 'Tümü'], ['watchlist', 'İzleyecekleri'], ['watching', 'İzliyor'], ['watched', 'İzledikleri'], ['paused', 'Ara verdikleri'], ['dropped', 'Yarım bıraktıkları']]
  const shown = rows.filter(r => filter === 'all' || r.entry.state === filter)
  const pages = Math.max(1, Math.ceil(shown.length / pageSize))
  const current = Math.min(page, pages)
  return <section className="filmcase-section" aria-labelledby="filmcase-heading">
    <h2 id="filmcase-heading" className="sr-only">Dizi raflarım</h2>
    <div className="filmcase-tabs" role="group" aria-label="Dizi rafları">{tabs.filter(([key]) => !quietShelves.includes(key) || filter === key || rows.some(r => r.entry.state === key)).map(([key, label]) =>
      <button key={key} type="button" aria-pressed={filter === key} onClick={() => { setFilter(key); setPage(1) }}>{label}<strong>{rows.filter(r => key === 'all' || r.entry.state === key).length}</strong></button>)}</div>
    {!shown.length ? <div className="filmcase-state"><h3>Bu raf henüz boş</h3>{own && <a className="primary" href={base + 'catalog'}>Kataloğu keşfet</a>}</div>
      : <div className="filmcase-cabinet"><div className="filmcase-marquee" aria-hidden="true" /><div className="filmcase">{shown.slice((current - 1) * pageSize, current * pageSize).map(({ entry, movie }) => <article className="filmcase-slot" key={movie.id}>
        <div className="filmcase-film">
          <a className="filmcase-case" href={base + 'movie/' + movie.id} aria-label={`${movie.title} detaylarını görüntüle`}><MiniPoster movie={movie} /></a>
          <span className={'filmcase-ribbon status-' + entry.state}>{ribbons[entry.state]}</span>
          {entry.overall != null && <span className="filmcase-score" title={`${own ? 'Puanın' : 'Puanı'}: ${score(entry.overall)} / 10`}>{score(entry.overall)}</span>}
        </div>
        <div className="filmcase-label"><h3 title={movie.title}><a href={base + 'movie/' + movie.id}>{movie.title}</a></h3><p>{[movie.director, movie.year].filter(Boolean).join(' · ') || 'Bilgi yok'}</p></div>
      </article>)}</div></div>}
    {pages > 1 && <nav className="filmcase-pagination" aria-label="Dizi arşivi sayfaları">
      <button className="outline-button" disabled={current <= 1} onClick={() => setPage(current - 1)}>Önceki</button><span>{current} / {pages}</span>
      <button className="outline-button" disabled={current >= pages} onClick={() => setPage(current + 1)}>Sonraki</button></nav>}
  </section>
}

/** Another viewer's profile: the same band without settings, a follow button and their shelf. */
export function PublicProfile({ nickname }: { nickname: string }) {
  const { account, api } = useCommunity()
  const path = '/api/people/' + encodeURIComponent(nickname)
  const profile = useResource<{ nickname: string; avatarId: string; entries: FilmRow[]; showcase?: ShowcaseData } & Journey>(account.session ? '/api/series/community/profile/' + encodeURIComponent(nickname) : null)
  const network = useResource<Network>(account.session ? path + '/network' : null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function follow() {
    setBusy(true); setError('')
    try { await api(path + '/follow', { method: network.data?.isFollowing ? 'DELETE' : 'PUT' }); network.retry() }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  if (!account.session) return <ViewerInvite nickname={nickname} />
  return <section className="film-profile-page">
    <a className="back-link" href={base + 'people'}>← Dizi severler</a>
    <ErrorBox message={profile.error} retry={profile.retry} />
    {profile.loading && <p className="muted" role="status">Profil yükleniyor…</p>}
    {profile.data && <>
      <header className="room-header"><h1>@{profile.data.nickname}</h1></header>
      <section className="viewer-band" aria-labelledby="public-band-heading">
        <div className="viewer-band-top"><h2 id="public-band-heading" className="viewer-band-kicker">İzleyici</h2>
          {network.data?.isSelf && <a className="band-settings" href={base + 'profile'}>Profilim ↗</a>}</div>
        <div className="viewer-band-row">
          <div className="viewer-band-who"><span className="avatar-edit"><CinemaAvatar id={profile.data.avatarId} /></span>
            <div><p className="viewer-band-name">@{profile.data.nickname}</p>
              {network.data && <p className="viewer-band-meta"><span>{network.data.followerCount} takipçi</span><span>{network.data.followingCount} takip</span></p>}
              {network.data && !network.data.isSelf && <button className={'band-follow' + (network.data.isFollowing ? ' following' : '')} disabled={busy} onClick={() => void follow()}>{busy ? 'Kaydediliyor…' : network.data.isFollowing ? 'Takipten çık' : 'Takip et'}</button>}
            </div></div>
          {profile.data.achievements && <JourneyChips journey={profile.data} own={false} />}
        </div>
        <ErrorBox message={error || network.error} retry={network.error ? network.retry : undefined} />
      </section>
      {network.data && !network.data.isSelf && <CompatibilityCard nickname={profile.data.nickname} />}
      {profile.data.showcase && <ShowcaseShelf showcase={profile.data.showcase} own={false} />}
      <FilmCase rows={profile.data.entries} own={false} />
    </>}
  </section>
}

/** What a signed-out visitor of a shared profile sees: an invitation to find their own viewer identity and their match. */
function ViewerInvite({ nickname }: { nickname: string }) {
  const { account } = useCommunity()
  return <aside className="viewer-invite" aria-labelledby="viewer-invite-heading">
    <div className="viewer-invite-copy">
      <p className="kicker">FAVO DİZİ</p>
      <h1 id="viewer-invite-heading">@{nickname}'in dizi arşivine bakıyorsun. <em>Sen hangi izleyicisin?</em></h1>
      <p>İzlediğin birkaç diziyi işaretle, puanla; izleyici kimliğini ve @{nickname} ile film uyumunu gör.</p>
    </div>
    <div className="viewer-invite-actions">
      <a className="primary" href={registerUrl} onClick={() => { if (pendingInvite()?.toLowerCase() !== nickname.toLowerCase()) rememberInvite(nickname) }}>İzleyici kimliğimi çıkar</a>
      <AccountDialog account={account} />
    </div>
    <p className="viewer-invite-note">Hesabın varsa giriş yap; @{nickname} ile film uyumunu hemen görürsün.</p>
  </aside>
}

type Compatibility = { ready: boolean; percent: number | null; label: string | null; sharedGenres: string[]; commonFilms: number; comparedRatings: number; suggestions: { movie: Film; score: number | null }[] }

/** The Books "okur uyumu" card for films: the match as a dial, shared genres and up to three of their loved films. */
function CompatibilityCard({ nickname }: { nickname: string }) {
  const { me } = useCommunity()
  const result = useResource<Compatibility>('/api/series/community/compatibility/' + encodeURIComponent(nickname))
  const [sharing, setSharing] = useState(false)
  const data = result.data
  const viewer = me?.nickname ?? null, linkable = !!viewer && !!me?.isPublic
  const draw = useCallback((format: CardFormat) => renderCompatibilityCard({ viewer, other: nickname, percent: data?.percent ?? 0, label: data?.label ?? null,
    sharedGenres: data?.sharedGenres ?? [], commonFilms: data?.commonFilms ?? 0, suggestion: data?.suggestions[0]?.movie ?? null }, format, linkable), [data, viewer, nickname, linkable])
  if (!data) return null
  if (!data.ready) return <section className="match-card match-card-pending" aria-label="İzleyici uyumu">
    <p>Uyumunuzu görmek için ikinizin de en az 5 izlenmiş dizisi ya da 3 değerlendirmesi olmalı. <a href={base + 'catalog'}>İzlediklerini işaretle →</a></p>
  </section>
  const percent = data.percent ?? 0
  const details = [data.commonFilms > 0 && `${data.commonFilms} ortak film`, data.comparedRatings > 0 && `${data.comparedRatings} ortak değerlendirme`].filter(Boolean).join(' · ')
  return <section className="match-card" aria-labelledby="match-card-heading">
    <div className="match-summary">
      <div className="match-dial" style={{ '--match': percent } as CSSProperties} aria-hidden="true"><span>%{percent}</span></div>
      <div>
        <p className="match-kicker">{data.label}</p>
        <h2 id="match-card-heading">@{nickname} ile <strong>%{percent}</strong> uyumlusunuz</h2>
        {data.sharedGenres.length > 0 && <p className="match-genres">Ortak kanalınız: {data.sharedGenres.join(', ')}</p>}
        {details && <p className="match-details">{details}</p>}
        <button type="button" className="film-share-button" onClick={() => setSharing(true)}>{shareIcon}Uyumu paylaş</button>
      </div>
    </div>
    {data.suggestions.length > 0 && <div className="match-suggestions">
      <h3>Onun sevdiği, senin henüz izlemediğin</h3>
      <ul>{data.suggestions.map(({ movie, score: value }) => <li key={movie.id}>
        <a className="match-cover" href={base + 'movie/' + movie.id} aria-label={movie.title}><MiniPoster movie={movie} /></a>
        <div><a href={base + 'movie/' + movie.id} className="match-film-title" title={movie.title}>{movie.title}</a>
          <p>{[movie.year, movie.director].filter(Boolean).join(' · ')}</p>
          {value != null && <p className="match-why">{score(value)} verdi</p>}</div>
      </li>)}</ul>
    </div>}
    <ShareSheet open={sharing} onClose={() => setSharing(false)} title="Uyumu paylaş" alt={`@${nickname} ile %${percent} izleyici uyumu`}
      render={draw} fileName="favo-izleyici-uyumu.png" shareText={`@${nickname} ile Favo'da %${percent} dizi uyumumuz var.`}
      link={linkable ? profileUrl(viewer!, 'uyum') : null} note={linkable ? 'Kartta profil adresin yazar.' : 'Profilin gizli olduğu için kartta yalnızca Favo adresi yazar.'} />
  </section>
}

import { MiniPoster, criteria, useCommunity, useResource, type Film } from './Community'
import { profileMatch } from './highlightMatch'
import './film-highlights.css'

const base = import.meta.env.BASE_URL

type Period = 'week' | 'month' | 'year' | 'all'
type HighlightFilm = { movie: Film; genres: number[]; score: number | null; ratings: number; viewers: number; strengths: string[] }
type HighlightList = { period: Period; films: HighlightFilm[] }
type Highlights = { star: HighlightList; mostWatched: HighlightList }

const starNotes: Record<Period, string> = {
  week: 'Son yedi günde en yüksek puanı alan dizi.',
  month: 'Bu hafta yeterince puan verilmedi; son 30 günün en yüksek puanlısı.',
  year: 'Bu ay yeterince puan verilmedi; son bir yılın en yüksek puanlısı.',
  all: 'Şimdiye kadar en yüksek puanı alan dizi.',
}
const watchNotes: Record<Period, string> = {
  week: 'Son yedi günde en çok “İzledim” denenler.',
  month: 'Son 30 günde en çok “İzledim” denenler.',
  year: 'Bu ay sessiz geçti; son bir yılda en çok “İzledim” denenler.',
  all: 'Şimdiye kadar en çok “İzledim” denenler.',
}
const shortCriteria: Record<string, string> = { theme: 'Konu', visuals: 'Görüntü', characters: 'Oyunculuk', structure: 'Senaryo', pace: 'Tempo', impact: 'Duygusal Etki', experience: 'İzleme Deneyimi' }

const scoreText = (score: number | null) => score === null ? '' : score.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const filmPath = (film: Film) => base + 'movie/' + film.id

/**
 * "Herkesin ekranından": the week's star and the month's most watched, the same for everyone except that the
 * viewer's own watched, started, rated and dismissed films are left out. A star that also fits the viewer's chosen
 * genres and criteria gets a gilded frame.
 */
export default function FilmHighlights() {
  const { me } = useCommunity()
  // Re-read whenever the viewer's archive or feedback changes, so a film they just watched leaves the list.
  const signature = me ? me.entries.map(row => row.movie.id + row.entry.state + (row.entry.overall ?? '')).join('|') + '#' + (me.feedback?.length ?? 0) : ''
  const result = useResource<Highlights>(me ? '/api/series/community/me/highlights?v=' + hash(signature) : null)
  const genres = useResource<{ id: number; name: string }[]>('/api/series/genres')
  const data = result.data
  if (!data || (!data.star.films.length && !data.mostWatched.films.length)) return null
  const choices = me?.preferences
  const [star, ...risers] = data.star.films
  const starMatch = star ? profileMatch(star, choices) : null
  const genreName = (id: number) => genres.data?.find(genre => genre.id === id)?.name ?? ''
  const matchText = starMatch && [...starMatch.genres.map(genreName), ...starMatch.criteria.map(c => shortCriteria[c] ?? criteria[c] ?? c)].filter(Boolean).join(' · ')

  return <section className="film-highlights" aria-labelledby="film-highlights-title">
    <header className="film-highlights-header">
      <h2 id="film-highlights-title">Herkesin ekranından</h2>
      <p>Profilinden bağımsız, izleyicilerin bu dönem öne çıkardıkları.</p>
    </header>
    <div className="film-highlights-grid">
      {star && <article className={starMatch ? 'highlight-star is-match' : 'highlight-star'} aria-labelledby="film-star-title">
        <p className="highlight-eyebrow"><span aria-hidden="true">✦</span> Haftanın yıldızı</p>
        {starMatch && <p className="highlight-match"><strong>Profiline birebir uyuyor</strong>{matchText && <span>{matchText}</span>}</p>}
        <div className="highlight-star-body">
          <a className="highlight-star-poster" href={filmPath(star.movie)} aria-label={`${star.movie.title} detaylarını görüntüle`}><MiniPoster movie={star.movie} /></a>
          <div className="highlight-star-copy">
            <h3 id="film-star-title"><a href={filmPath(star.movie)}>{star.movie.title}</a></h3>
            <p className="highlight-meta">{[star.movie.year, star.movie.director].filter(Boolean).join(' · ')}</p>
            <p className="highlight-score"><strong>{scoreText(star.score)}</strong><span>/ 10 · {star.ratings} değerlendirme</span></p>
            <p className="highlight-note">{starNotes[data.star.period]}</p>
          </div>
        </div>
        {risers.length > 0 && <ol className="highlight-risers" aria-label="Puanı yüksek diğer diziler">
          {risers.map((film, index) => {
            const match = profileMatch(film, choices)
            return <li key={film.movie.id}>
              <span className="highlight-rank" aria-hidden="true">{index + 2}</span>
              <a href={filmPath(film.movie)}>{film.movie.title}</a>
              {match && <span className="highlight-match-mark" title="Profiline uyuyor">✦ sana uygun</span>}
              <span className="highlight-value">{scoreText(film.score)}</span>
            </li>
          })}
        </ol>}
      </article>}
      {data.mostWatched.films.length > 0 && <article className="highlight-most-watched" aria-labelledby="film-most-watched-title">
        <h3 id="film-most-watched-title" className="highlight-eyebrow">Ayın en çok izlenenleri</h3>
        <p className="highlight-note">{watchNotes[data.mostWatched.period]}</p>
        <ol>
          {data.mostWatched.films.map((film, index) => <li key={film.movie.id}>
            <span className="highlight-rank" aria-hidden="true">{index + 1}</span>
            <a className="highlight-mini-poster" href={filmPath(film.movie)} tabIndex={-1} aria-hidden="true"><MiniPoster movie={film.movie} /></a>
            <div>
              <a href={filmPath(film.movie)}>{film.movie.title}</a>
              <small>{[film.movie.year, film.movie.director].filter(Boolean).join(' · ')}</small>
            </div>
            <span className="highlight-value">{film.viewers} izleyici</span>
          </li>)}
        </ol>
      </article>}
    </div>
  </section>
}

function hash(text: string) {
  let value = 0
  for (const character of text) value = (value * 31 + character.charCodeAt(0)) | 0
  return (value >>> 0).toString(36)
}

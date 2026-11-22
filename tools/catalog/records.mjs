// Builds a manifest record from Wikidata source facts. Used by prepare (to write) and verify (to re-check).
import { cleanTitle, sha256 } from './wikidata.mjs'

// Wikidata genres are fine-grained ("neo-noir", "space opera"); the catalog keeps the 18 Favo genres
// (TMDB-compatible ids). Rules are checked against the English genre label, first match per rule set wins.
export const genreRules = [
  [28, /\b(action|martial arts|superhero|swashbuckler|spy (film|fiction|television series)|disaster)\b/],
  [12, /\b(adventure|swashbuckler)\b/],
  // Animation only for genuinely animated genres ("live-action/animated" works are not animation).
  [16, /^(animated (television )?series|animated sitcom|anime( television series)?|adult animat(ed|ion)( television series)?|animated comedy( television series)?|cartoon|computer-animated (television )?series)$/],
  [35, /\b(comedy|comedic|sitcom|satir|parody|black comedy|sketch)/],
  [80, /\b(crime|gangster|heist|neo-noir|film noir|mafia|police procedural|prison)\b/],
  [99, /\bdocumentary\b/],
  [18, /\b(drama|melodrama|tragedy|coming-of-age|biographical|soap opera|telenovela)\b/],
  [10751, /\b(family|children's|christmas)\b/],
  [14, /\b(fantasy|fairy tale|sword and sorcery|supernatural)\b/],
  [36, /\b(historical|history|biographical|costume drama|period drama|period film|period piece)\b/],
  [27, /\b(horror|slasher|zombie|vampire|monster)\b/],
  [10402, /\b(musical|music|dance)\b/],
  [9648, /\b(mystery|detective|whodunit|psychological thriller)\b/],
  [10749, /\b(romance|romantic|telenovela)\b/],
  [878, /\b(science fiction|sci-fi|cyberpunk|space opera|dystopian|post-apocalyptic|time travel)\b/],
  [53, /\b(thriller|suspense|neo-noir|erotic thriller)\b/],
  [10752, /\b(war|anti-war)\b/],
  [37, /\b(western|spaghetti western)\b/],
]

// Animated series and anime series as the item type also mean Animation.
const animatedTypes = ['Q581714', 'Q63952888', 'Q117467246']
export const maxGenres = 4
const programGenres = /(reality|game show|talk show|variety show|quiz|sports entertainment|professional wrestling|news|award show|competition)/

/** Wikidata lists genres roughly by importance; the first four distinct Favo genres are kept. */
export function mapGenres(genreIds, labels, instanceOf = []) {
  const mapped = []
  if (instanceOf.some(t => animatedTypes.includes(t))) mapped.push(16)
  for (const id of genreIds) {
    const english = (labels[id]?.en ?? '').toLowerCase()
    for (const [genre, rule] of genreRules) if (rule.test(english) && !mapped.includes(genre)) mapped.push(genre)
  }
  return mapped.slice(0, maxGenres).sort((a, b) => a - b)
}

const name = (labels, id) => labels[id]?.name ?? null
const releaseDate = time => /^\+(\d{4})-(\d{2})-(\d{2})T/.exec(time ?? '')
// Not a series of its own (an episode, a season, a franchise or a single TV film): kept out of the catalog with a note.
const excludedTypes = { Q21191270: 'bölüm', Q3464665: 'sezon', Q506240: 'televizyon filmi', Q196600: 'medya serisi', Q11424: 'film' }

/** The catalog record (without Number/EvidenceNote) and why it would be hidden, if it would. */
export function buildRecord(facts, labels, currentYear) {
  const date = releaseDate(facts.firstRelease)
  const year = date ? Number(date[1]) : null
  const title = cleanTitle(facts.trLabel ?? facts.trWikiTitle ?? '')
  const hidden = []
  if (!title) hidden.push('Türkçe ad yok')
  if (!year) hidden.push('yayın yılı yok')
  else if (year > currentYear) hidden.push('henüz yayımlanmadı')
  const end = releaseDate(facts.lastAired)
  for (const [type, label] of Object.entries(excludedTypes)) if (facts.instanceOf.includes(type)) hidden.push(label)
  // Shows that are not series (reality, competitions, talk, variety, sport, news) stay out. Turkish series often carry no
  // genre on Wikidata and are kept; a foreign item whose genres map to nothing is usually such a show.
  const genreLabels = facts.genres.map(id => (labels[id]?.en ?? '').toLowerCase())
  if (genreLabels.some(l => programGenres.test(l))) hidden.push('program, dizi değil')
  else if (!facts.countries.includes('Q43') && mapGenres(facts.genres, labels, facts.instanceOf).length === 0) hidden.push('tür eşlenemedi (program olabilir)')
  const record = {
    WikidataId: facts.wikidataId,
    Revision: facts.revision,
    Title: title,
    OriginalTitle: facts.originalTitle ?? facts.enLabel ?? null,
    ReleaseYear: year,
    // Wikidata uses -00 for unknown month/day; those dates keep only the year.
    ReleaseDate: date && date[2] !== '00' && date[3] !== '00' ? `${date[1]}-${date[2]}-${date[3]}` : null,
    // For a series this is the length of an episode.
    RuntimeMinutes: facts.runtimeMinutes > 0 && facts.runtimeMinutes < 1000 ? facts.runtimeMinutes : null,
    EndYear: end && Number(end[1]) >= (year ?? 0) && Number(end[1]) <= currentYear ? Number(end[1]) : null,
    Seasons: facts.seasons > 0 && facts.seasons < 200 ? facts.seasons : null,
    Episodes: facts.episodes > 0 && facts.episodes < 20000 ? facts.episodes : null,
    Networks: facts.networks.map(id => labels[id]?.tr ?? labels[id]?.name ?? labels[id]?.en).filter(Boolean),
    Genres: mapGenres(facts.genres, labels, facts.instanceOf),
    Directors: facts.directors.map(id => name(labels, id)).filter(Boolean),
    Cast: facts.cast.map(id => name(labels, id)).filter(Boolean).slice(0, 8),
    Countries: facts.countries.map(id => labels[id]?.tr ?? labels[id]?.en).filter(Boolean),
    OriginalLanguage: facts.languages.map(id => labels[id]?.tr ?? labels[id]?.en).find(Boolean) ?? null,
    ImdbId: facts.imdbId,
    TmdbId: facts.tmdbId ? Number(facts.tmdbId) : null,
    Popularity: facts.sitelinks,
    SourceUrl: `https://www.wikidata.org/w/index.php?title=${facts.wikidataId}&oldid=${facts.revision}`,
    SourceSha256: sha256(facts),
  }
  return { record, hidden }
}

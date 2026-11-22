/** The viewer's saved choices on the home page: up to five genres (TMDB ids) and three rating criteria. */
export type ViewingChoices = { genres: number[]; criteria: string[] }

/** What made a general pick match the viewer: the shared genres and the chosen criteria the film is strong in. */
export type ProfileMatch = { genres: number[]; criteria: string[] }

/**
 * A highlighted film matches the viewer's profile when it is in one of their chosen genres and viewers rated it
 * strongly (8+) in at least half of their chosen criteria. Either side may be left empty, but not both.
 * Same rule as Kitap's highlightMatch.ts.
 */
export function profileMatch(film: { genres: number[]; strengths: string[] }, choices: ViewingChoices | null | undefined): ProfileMatch | null {
  if (!choices || (!choices.genres.length && !choices.criteria.length)) return null
  const genres = film.genres.filter(genre => choices.genres.includes(genre))
  if (choices.genres.length && !genres.length) return null
  const criteria = choices.criteria.filter(criterion => film.strengths.includes(criterion))
  if (criteria.length < Math.ceil(choices.criteria.length / 2)) return null
  return { genres, criteria }
}

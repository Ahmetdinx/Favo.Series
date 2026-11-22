// Shared Wikidata helpers for the offline Dizi (TV series) catalog tools. Wikidata data is CC0.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// Wikimedia asks automated clients for a descriptive User-Agent; no personal contact data is sent.
const headers = { 'User-Agent': 'FavoCatalogTools/0.1 (offline TV series catalog import; Node.js)', 'Accept': 'application/json' }
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function getJson(url, attempt = 1) {
  const response = await fetch(url, { headers })
  if ((response.status === 429 || response.status >= 500) && attempt < 8) {
    // Honour Retry-After; otherwise back off progressively (Wikimedia rate limits bursts).
    const retryAfter = Number(response.headers.get('retry-after'))
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * attempt)
    return getJson(url, attempt + 1)
  }
  if (!response.ok) throw new Error(`${response.status} ${url.slice(0, 120)}`)
  return response.json()
}

export async function sparql(query) {
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query)
  const data = await getJson(url)
  return data.results.bindings.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v.value])))
}

export const qid = uri => uri.replace('http://www.wikidata.org/entity/', '')

/** Fetches entities 50 at a time (the API limit), politely and sequentially. */
export async function getEntities(ids, { props = 'labels|descriptions|claims|sitelinks|info', languages = 'tr|en', cachePath = null, map = e => e } = {}) {
  // An optional cache lets an interrupted run continue where it stopped; `map` keeps only what is needed.
  const result = cachePath ? readJson(cachePath, {}) : {}
  const unique = [...new Set(ids)].filter(id => !(id in result))
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50)
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&maxlag=5&ids=${chunk.join('|')}&props=${props}&languages=${languages}`
    const data = await getJson(url)
    for (const [id, entity] of Object.entries(data.entities)) result[id] = entity.missing !== undefined ? null : map(entity)
    const done = Math.min(i + 50, unique.length)
    if (done % 500 === 0 || done === unique.length) {
      console.log(`  ${done}/${unique.length} kayıt`)
      if (cachePath) writeJson(cachePath, result)
    }
    await sleep(1000)
  }
  return result
}

const values = (entity, property) => (entity.claims?.[property] ?? [])
  .filter(c => c.mainsnak?.snaktype === 'value' && c.rank !== 'deprecated')
  .sort((a, b) => (b.rank === 'preferred') - (a.rank === 'preferred'))
  .map(c => c.mainsnak.datavalue.value)
const ids = (entity, property) => values(entity, property).map(v => v.id).filter(Boolean)
const strings = (entity, property) => values(entity, property).filter(v => typeof v === 'string')

/** Turkish Wikipedia titles carry disambiguation like "(dizi)" or "(2005 TV dizisi)"; the catalog title drops it. */
export const cleanTitle = title => title.replace(/\s*\((?:[^()]*\b)?(?:dizi|dizisi|tv dizisi|televizyon dizisi|mini dizi|animasyon dizisi|anime|web dizisi)(?:,? \d{4})?\)\s*$/i, '').trim()

/** The source facts a manifest record is built from; their hash is the record's SourceSha256. */
export function sourceFacts(entity) {
  // A series runs from its start time (P580) to its end time (P582); some items only carry a publication date (P577).
  const dates = [...values(entity, 'P580'), ...values(entity, 'P577')].map(v => v.time).filter(Boolean).sort()
  const ends = values(entity, 'P582').map(v => v.time).filter(Boolean).sort()
  const count = property => { const v = values(entity, property).map(x => Math.round(Number(x.amount))).filter(n => n > 0); return v.length ? Math.max(...v) : null }
  const minutes = values(entity, 'P2047').find(v => v.unit === 'http://www.wikidata.org/entity/Q7727')
  const original = values(entity, 'P1476').find(v => v.text)
  return {
    wikidataId: entity.id,
    revision: entity.lastrevid,
    trLabel: entity.labels?.tr?.value ?? null,
    enLabel: entity.labels?.en?.value ?? null,
    trWikiTitle: entity.sitelinks?.trwiki?.title ?? null,
    originalTitle: original?.text ?? null,
    originalTitleLanguage: original?.language ?? null,
    firstRelease: dates[0] ?? null,
    lastAired: ends.at(-1) ?? null,
    seasons: count('P2437'),
    episodes: count('P1113'),
    networks: ids(entity, 'P449').slice(0, 3),
    runtimeMinutes: minutes ? Math.round(Number(minutes.amount)) : null,
    genres: ids(entity, 'P136'),
    // Series are credited to their creators (P170); directors (P57) only when no creator is listed.
    directors: (ids(entity, 'P170').length ? ids(entity, 'P170') : ids(entity, 'P57')).slice(0, 4),
    // Animated series list voice actors (P725) instead of cast members (P161).
    cast: (ids(entity, 'P161').length ? ids(entity, 'P161') : ids(entity, 'P725')).slice(0, 10),
    countries: ids(entity, 'P495'),
    languages: ids(entity, 'P364'),
    imdbId: strings(entity, 'P345').find(v => /^tt\d+$/.test(v)) ?? null,
    tmdbId: strings(entity, 'P4947').find(v => /^\d+$/.test(v)) ?? null,
    instanceOf: ids(entity, 'P31'),
    sitelinks: Object.keys(entity.sitelinks ?? {}).length,
  }
}

export const sha256 = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')

export function readJson(path, fallback) { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback }
export function writeJson(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n') }
// People usually carry a language-independent "mul" label instead of separate tr/en labels.
export const label = entity => entity?.labels?.tr?.value ?? entity?.labels?.mul?.value ?? entity?.labels?.en?.value ?? null
export const labelLanguages = 'tr|mul|en'
export const toLabel = entity => ({ tr: entity.labels?.tr?.value ?? null, en: entity.labels?.en?.value ?? entity.labels?.mul?.value ?? null, name: label(entity) })

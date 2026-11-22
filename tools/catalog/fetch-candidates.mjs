// Step 1: collect well-known TV series that have a Turkish Wikipedia article, with their Wikidata source facts.
// Usage: node tools/catalog/fetch-candidates.mjs [minSitelinks=25] [labelLimit=1500] [turkishMinSitelinks=4]
// Turkish series (country of origin Türkiye) have far fewer language editions, so they are collected with a lower bar.
// Output (git-ignored): artifacts/catalog/candidates.json and artifacts/catalog/labels.json
import { getEntities, labelLanguages, qid, readJson, sourceFacts, sparql, toLabel, writeJson } from './wikidata.mjs'

const minSitelinks = Number(process.argv[2] ?? 25)
const turkishMinSitelinks = Number(process.argv[4] ?? 4)
// Television series, animated series, miniseries, anime series, web series.
const types = ['Q5398426', 'Q581714', 'Q1259759', 'Q63952888', 'Q526877', 'Q117467246']

console.log(`Wikidata: en az ${minSitelinks} dilde (Türk dizilerinde ${turkishMinSitelinks}) maddesi olan diziler aranıyor…`)
const found = new Map()
for (const type of types) {
  const rows = await sparql(`SELECT ?film ?links WHERE { ?film wdt:P31 wd:${type} ; wikibase:sitelinks ?links . FILTER(?links >= ${minSitelinks}) }`)
  for (const row of rows) found.set(qid(row.film), Number(row.links))
  const turkish = await sparql(`SELECT ?film ?links WHERE { ?film wdt:P31 wd:${type} ; wdt:P495 wd:Q43 ; wikibase:sitelinks ?links . FILTER(?links >= ${turkishMinSitelinks}) }`)
  for (const row of turkish) found.set(qid(row.film), Number(row.links))
  console.log(`  ${type}: ${rows.length} dizi, ${turkish.length} Türk dizisi`)
}
console.log(`${found.size} aday; varlık bilgileri alınıyor…`)

const facts = await getEntities([...found.keys()], { cachePath: 'artifacts/catalog/facts-cache.json', map: sourceFacts })
const candidates = Object.values(facts)
  .filter(f => f?.trWikiTitle)
  .sort((a, b) => b.sitelinks - a.sitelinks || a.wikidataId.localeCompare(b.wikidataId))
console.log(`Türkçe Vikipedi maddesi olan: ${candidates.length}`)

// Labels for people, genres, countries and languages, only for the best-known candidates a batch can use
// (fetching names for every candidate would mean tens of thousands of requests). Later batches raise the limit.
const labelLimit = Number(process.argv[3] ?? 1500)
const referenced = new Set(candidates.slice(0, labelLimit).flatMap(c => [...c.genres, ...c.directors, ...c.cast, ...c.countries, ...c.languages, ...c.networks]))
const labelsPath = 'artifacts/catalog/labels.json'
const cachePath = 'artifacts/catalog/labels-cache.json'
// Entries without a name are fetched again (older runs did not ask for "mul" labels).
const cache = readJson(cachePath, {})
for (const [id, value] of Object.entries(cache)) if (!value?.name) delete cache[id]
writeJson(cachePath, cache)
const labels = Object.fromEntries(Object.entries(readJson(labelsPath, {})).filter(([, v]) => v?.name))
const missing = [...referenced].filter(id => !(id in labels))
console.log(`${missing.length} etiket alınıyor…`)
const labelled = await getEntities(missing, { props: 'labels', languages: labelLanguages, cachePath, map: toLabel })
Object.assign(labels, labelled)

writeJson(labelsPath, labels)
writeJson('artifacts/catalog/candidates.json', { fetchedAtUtc: new Date().toISOString(), minSitelinks, candidates })
console.log('Yazıldı: artifacts/catalog/candidates.json')

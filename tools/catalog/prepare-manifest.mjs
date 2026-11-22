// Step 2: pick the best-known candidates and write a reviewable batch manifest.
// Usage: node tools/catalog/prepare-manifest.mjs <batch-folder-name> [count=500] [turkish=100]
// Up to <turkish> places go to the best-known Turkish series (they have few language editions and would
// otherwise never make the cut); the rest are the best-known series overall. Series already in an earlier batch (any data/curation/*/manifest.json) are skipped; numbering continues after them.
// Reads artifacts/catalog/candidates.json + labels.json; writes data/curation/<batch>/manifest.json, review.tsv, genre-map.tsv.
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { buildRecord, genreRules } from './records.mjs'
import { readJson, writeJson } from './wikidata.mjs'

const [batch, count = '500', turkishCount = '100'] = process.argv.slice(2)
if (!batch) { console.error('Kullanım: node tools/catalog/prepare-manifest.mjs series-YYYYMMDD [adet] [türk-dizisi]'); process.exit(1) }
const { candidates, fetchedAtUtc } = readJson('artifacts/catalog/candidates.json')
const labels = readJson('artifacts/catalog/labels.json', {})
const currentYear = new Date().getUTCFullYear()

const earlier = readdirSync('data/curation').filter(d => d !== batch && existsSync(`data/curation/${d}/manifest.json`))
  .flatMap(d => readJson(`data/curation/${d}/manifest.json`, []))
const taken = new Set(earlier.map(r => r.WikidataId))
const first = earlier.reduce((max, r) => Math.max(max, r.Number), 0)
const built = candidates.filter(f => !taken.has(f.wikidataId)).map(facts => ({ facts, ...buildRecord(facts, labels, currentYear) }))
const eligible = built.filter(b => b.hidden.length === 0)
const isTurkish = b => b.facts.countries.includes('Q43')
const turkish = eligible.filter(isTurkish).slice(0, Number(turkishCount))
const others = eligible.filter(b => !isTurkish(b)).slice(0, Math.max(0, Number(count) - turkish.length))
const accepted = [...turkish, ...others].sort((a, b) => b.record.Popularity - a.record.Popularity || a.record.WikidataId.localeCompare(b.record.WikidataId))
const manifest = accepted.map((b, i) => ({
  Number: first + i + 1,
  ...b.record,
  EvidenceNote: `Wikidata (CC0), ${fetchedAtUtc.slice(0, 10)}: Türkçe Vikipedi maddesi olan, ${b.record.Popularity} dilde maddesi bulunan dizi. Künye kaynak revizyonundan alındı.`,
  Decision: 'Film',
}))
const dir = `data/curation/${batch}`
writeJson(`${dir}/manifest.json`, manifest)

// review.tsv: what a person should look at before applying (no genre, no director, no runtime) plus skipped candidates.
const rows = [['Number', 'WikidataId', 'Title', 'Year', 'Issue']]
for (const r of manifest) {
  const issues = [!r.Genres.length && 'tür eşlenemedi', !r.Directors.length && 'yaratıcı yok', !r.Seasons && 'sezon sayısı yok'].filter(Boolean)
  if (issues.length) rows.push([r.Number, r.WikidataId, r.Title, r.ReleaseYear, issues.join(', ')])
}
for (const b of built.filter(b => b.hidden.length).slice(0, 300)) rows.push(['-', b.facts.wikidataId, b.record.Title, b.record.ReleaseYear ?? '', 'alınmadı: ' + b.hidden.join(', ')])
writeFileSync(`${dir}/review.tsv`, rows.map(r => r.join('\t')).join('\n') + '\n')

// genre-map.tsv: every Wikidata genre seen in the batch and the Favo genres it maps to, for review.
const seen = new Map()
for (const b of accepted) for (const g of b.facts.genres) seen.set(g, (seen.get(g) ?? 0) + 1)
const genreRows = [['WikidataGenre', 'Label', 'Series', 'FavoGenres']]
for (const [id, n] of [...seen].sort((a, b) => b[1] - a[1])) {
  const english = (labels[id]?.en ?? '').toLowerCase()
  genreRows.push([id, labels[id]?.en ?? labels[id]?.tr ?? '', n, genreRules.filter(([, rule]) => rule.test(english)).map(([g]) => g).join(',')])
}
writeFileSync(`${dir}/genre-map.tsv`, genreRows.map(r => r.join('\t')).join('\n') + '\n')

console.log(`${manifest.length} dizi (${turkish.length} Türk dizisi) manifest'e yazıldı (${dir}). İnceleme: ${rows.length - 1} satır; ${built.filter(b => b.hidden.length).length} aday alınmadı.`)

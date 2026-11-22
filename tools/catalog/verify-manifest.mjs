// Step 3: re-read every record's source from Wikidata and check the manifest still matches it.
// Usage: node tools/catalog/verify-manifest.mjs <batch-folder-name>
// Writes data/curation/<batch>/verification.json; the import tool only applies a manifest whose hash matches
// a verification produced in the last 24 hours with no errors.
import { readFileSync } from 'node:fs'
import { buildRecord } from './records.mjs'
import { getEntities, labelLanguages, readJson, sha256, sourceFacts, toLabel, writeJson } from './wikidata.mjs'

const [batch] = process.argv.slice(2)
if (!batch) { console.error('Kullanım: node tools/catalog/verify-manifest.mjs series-YYYYMMDD'); process.exit(1) }
const dir = `data/curation/${batch}`
const raw = readFileSync(`${dir}/manifest.json`, 'utf8')
const manifest = JSON.parse(raw)

console.log(`${manifest.length} kayıt Wikidata'dan yeniden okunuyor…`)
const facts = await getEntities(manifest.map(r => r.WikidataId), { map: sourceFacts })
const labels = readJson('artifacts/catalog/labels.json', {})
const people = new Set(Object.values(facts).flatMap(f => f ? [...f.genres, ...f.directors, ...f.cast, ...f.countries, ...f.languages, ...f.networks] : []))
const unknown = [...people].filter(id => !labels[id]?.name)
if (unknown.length) Object.assign(labels, await getEntities(unknown, { props: 'labels', languages: labelLanguages, map: toLabel }))

const errors = []
const numbers = new Set(), ids = new Set()
for (const record of manifest) {
  if (numbers.has(record.Number) || ids.has(record.WikidataId)) errors.push(`${record.WikidataId}: tekrarlanan kayıt`)
  numbers.add(record.Number); ids.add(record.WikidataId)
  if (!['Film', 'Hidden'].includes(record.Decision)) errors.push(`${record.WikidataId}: geçersiz karar ${record.Decision}`)
  const current = facts[record.WikidataId]
  if (!current) { errors.push(`${record.WikidataId}: Wikidata'da bulunamadı`); continue }
  if (current.revision !== record.Revision) { errors.push(`${record.WikidataId}: kaynak değişti (${record.Revision} → ${current.revision}); manifest yeniden hazırlanmalı`); continue }
  const { record: rebuilt } = buildRecord(current, labels, new Date().getUTCFullYear())
  for (const [key, value] of Object.entries(rebuilt))
    if (JSON.stringify(value) !== JSON.stringify(record[key])) errors.push(`${record.WikidataId}: ${key} kaynakla uyuşmuyor`)
}

writeJson(`${dir}/verification.json`, { ManifestSha256: sha256(raw), Verified: manifest.length - new Set(errors.map(e => e.split(':')[0])).size, CheckedAtUtc: new Date().toISOString(), Errors: errors })
console.log(errors.length ? `${errors.length} hata; ilk örnekler:\n${errors.slice(0, 10).join('\n')}` : `Doğrulandı: ${manifest.length} kayıt.`)

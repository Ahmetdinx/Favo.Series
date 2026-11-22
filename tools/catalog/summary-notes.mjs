// Helper for writing Favo's own series summaries.
//   node tools/catalog/summary-notes.mjs fetch            fetch reference notes for every film in data/curation/*/manifest.json
//   node tools/catalog/summary-notes.mjs show <from> <n>   print compact notes for films <from>..<from+n-1> (manifest Number)
//   node tools/catalog/summary-notes.mjs merge             merge artifacts/catalog/summaries/*.tsv into data/curation/series-summaries/summaries.tsv
// Notes are the English Wikipedia lead (CC BY-SA) and stay in artifacts/ (git-ignored). They are only a factual reference:
// summaries are written in our own Turkish words and never copy or translate the article text.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { getEntities, readJson, writeJson } from './wikidata.mjs'

const [command, from, count] = process.argv.slice(2)
const manifests = readdirSync('data/curation').filter(d => existsSync(`data/curation/${d}/manifest.json`))
  .flatMap(d => readJson(`data/curation/${d}/manifest.json`, [])).sort((a, b) => a.Number - b.Number)
const notesPath = 'artifacts/catalog/notes-cache.json'
const headers = { 'User-Agent': 'FavoCatalogTools/0.1 (offline film catalog import; Node.js)' }
const sleep = ms => new Promise(r => setTimeout(r, ms))

if (command === 'fetch') {
  const notes = readJson(notesPath, {})
  const missing = manifests.filter(r => !(r.WikidataId in notes))
  console.log(`${missing.length} film için İngilizce Vikipedi başlığı alınıyor…`)
  const titles = await getEntities(missing.map(r => r.WikidataId), { props: 'sitelinks', map: e => e.sitelinks?.enwiki?.title ?? null })
  const withTitle = missing.filter(r => titles[r.WikidataId])
  for (const r of missing.filter(r => !titles[r.WikidataId])) notes[r.WikidataId] = ''
  for (let i = 0; i < withTitle.length; i += 20) {
    const chunk = withTitle.slice(i, i + 20)
    const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=1&explaintext=1&exlimit=20&redirects=1&titles='
      + encodeURIComponent(chunk.map(r => titles[r.WikidataId]).join('|'))
    let data
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(url, { headers })
      if (response.ok) { data = await response.json(); break }
      if (attempt >= 6) throw new Error(`${response.status} Wikipedia`)
      await sleep(Number(response.headers.get('retry-after')) * 1000 || 4000 * attempt)
    }
    // Map redirects/normalisation back to the requested titles.
    const alias = new Map()
    for (const n of [...(data.query.normalized ?? []), ...(data.query.redirects ?? [])]) alias.set(n.to, alias.get(n.from) ?? n.from)
    const byTitle = new Map(Object.values(data.query.pages).map(p => [alias.get(p.title) ?? p.title, (p.extract ?? '').replace(/\s+/g, ' ').trim()]))
    for (const r of chunk) notes[r.WikidataId] = byTitle.get(titles[r.WikidataId]) ?? ''
    if ((i / 20) % 10 === 9 || i + 20 >= withTitle.length) { writeJson(notesPath, notes); console.log(`  ${Math.min(i + 20, withTitle.length)}/${withTitle.length}`) }
    await sleep(500)
  }
  writeJson(notesPath, notes)
  console.log(`Notlar hazır: ${Object.values(notes).filter(Boolean).length} dizi.`)
} else if (command === 'show') {
  const notes = readJson(notesPath, {})
  const start = Number(from), end = start + Number(count ?? 50)
  for (const r of manifests.filter(r => r.Number >= start && r.Number < end)) {
    const note = (notes[r.WikidataId] ?? '').slice(0, 700)
    console.log(`${r.Number}\t${r.WikidataId}\t${r.Title} (${r.OriginalTitle ?? '-'}, ${r.ReleaseYear}–${r.EndYear ?? ''}, ${r.Seasons ?? '?'} sezon, ${(r.Countries ?? []).join('/')}) · ${r.Directors.slice(0, 2).join(', ')} · ${r.Cast.slice(0, 3).join(', ')}\n  ${note}`)
  }
} else if (command === 'merge') {
  const dir = 'artifacts/catalog/summaries'
  const rows = new Map()
  for (const file of existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.tsv')).sort() : [])
    for (const line of readFileSync(`${dir}/${file}`, 'utf8').split(/\r?\n/)) {
      const [id, text] = line.split('\t')
      if (/^Q\d+$/.test(id ?? '') && text?.trim()) rows.set(id, text.trim())
    }
  const order = new Map(manifests.map(r => [r.WikidataId, r.Number]))
  const known = [...rows].filter(([id]) => order.has(id)).sort((a, b) => order.get(a[0]) - order.get(b[0]))
  const tooShort = known.filter(([, t]) => t.length < 40 || t.length > 1500)
  if (tooShort.length) { console.error(`Uzunluğu uygun olmayan özetler: ${tooShort.map(([id]) => id).join(', ')}`); process.exit(1) }
  mkdirSync('data/curation/series-summaries', { recursive: true })
  writeFileSync('data/curation/series-summaries/summaries.tsv', ['WikidataId\tSummary', ...known.map(([id, t]) => `${id}\t${t}`)].join('\n') + '\n')
  console.log(`${known.length} özet data/curation/series-summaries/summaries.tsv dosyasına yazıldı.`)
} else {
  console.error('Kullanım: fetch | show <başlangıç> <adet> | merge')
  process.exit(1)
}

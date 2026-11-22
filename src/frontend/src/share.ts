/**
 * Favo Dizi share cards, drawn on a canvas in the two formats Books uses: a 9:16 story and a 4:5 post.
 * The look is the cinema version of the Books library card: a wine screen between film perforations,
 * a gold header line and a footer that always leads back to Favo. Covers are Favo's typographic covers.
 */
export type CardFormat = 'story' | 'post'
export type CardFilm = { id: number; title: string; year?: number | null; director?: string | null }

const W = 1080
const HEIGHT: Record<CardFormat, number> = { story: 1920, post: 1350 }
export const serif = 'Georgia, "Times New Roman", serif'
const sans = 'Inter, "Segoe UI", sans-serif'
export const cream = '#e0f5f6', gold = '#86d6d9', muted = '#a5b0b8'
const tones: [string, string][] = [['#2e536a', '#1b252a'], ['#27424a', '#141d22'], ['#26585a', '#122121'], ['#2f2c55', '#16142a'], ['#3d4a2c', '#1a2014'], ['#26465b', '#0f1b24']]

/** The viewer's public Film profile, printed on cards and shared as the link. */
export function profileUrl(nickname: string, source?: 'kart' | 'link' | 'uyum') {
  const url = new URL(import.meta.env.BASE_URL + 'people/' + encodeURIComponent(nickname), window.location.origin)
  if (source) { url.searchParams.set('ref', nickname); url.searchParams.set('src', source) }
  return url.href
}

export function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 3) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? line + ' ' + word : word
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word } else line = next
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…' }
  return lines
}

const decimal = (value: number) => value.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Favo's typographic film cover, the canvas twin of the FilmCover component. */
export function drawFilmCover(ctx: CanvasRenderingContext2D, film: CardFilm, x: number, y: number, w: number, h: number, shadow = true) {
  const [from, to] = tones[film.id % 6]
  ctx.save()
  if (shadow) { ctx.shadowColor = 'rgba(0, 0, 0, .6)'; ctx.shadowBlur = w * .18; ctx.shadowOffsetY = w * .08 }
  const g = ctx.createLinearGradient(x, y, x + w * .6, y + h)
  g.addColorStop(0, from); g.addColorStop(.7, to)
  ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(x, y, w, h, w * .04); ctx.fill()
  ctx.restore()
  const pad = w * .09
  ctx.save()
  ctx.strokeStyle = 'rgba(220, 240, 241, .2)'; ctx.lineWidth = Math.max(1, w * .006)
  ctx.beginPath(); ctx.roundRect(x + w * .05, y + w * .05, w * .9, h - w * .1, 3); ctx.stroke()
  ctx.fillStyle = 'rgba(134, 214, 217, .8)'; ctx.font = `600 ${Math.round(w * .055)}px ${sans}`
  ctx.fillText('FAVO DİZİ', x + pad, y + pad + w * .06)
  const size = Math.round(w * .135)
  ctx.fillStyle = cream; ctx.font = `${size}px ${serif}`
  const lines = wrap(ctx, film.title, w - pad * 2, 4)
  const titleTop = y + h * .5 - lines.length * size * 1.12
  lines.forEach((line, i) => ctx.fillText(line, x + pad, titleTop + (i + 1) * size * 1.12))
  const rule = ctx.createLinearGradient(x + pad, 0, x + w - pad, 0)
  rule.addColorStop(0, 'rgba(134, 214, 217, .6)'); rule.addColorStop(1, 'rgba(134, 214, 217, 0)')
  ctx.fillStyle = rule; ctx.fillRect(x + pad, y + h * .52, w - pad * 2, Math.max(1, w * .005))
  const meta = [film.year, film.director].filter(Boolean).join(' · ')
  if (meta) { ctx.fillStyle = 'rgba(174, 228, 230, .8)'; ctx.font = `${Math.round(w * .065)}px ${sans}`; ctx.fillText(wrap(ctx, meta, w - pad * 2, 1)[0], x + pad, y + h - pad) }
  ctx.restore()
}

export type CardFrame = { ctx: CanvasRenderingContext2D; story: boolean; left: number; right: number; width: number; top: number; bottom: number; footerTop: number }

/** Wine screen, perforated edges, gold header and a footer that leads back to Favo. */
export function drawCardFrame(canvas: HTMLCanvasElement, format: CardFormat, header: { kicker: string; right?: string; owner?: string | null },
  footer: { question: string; address: string; detail?: string }): CardFrame {
  const H = HEIGHT[format], story = format === 'story'
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  const left = 130, right = W - 130, width = right - left, top = 100, bottom = H - 100

  const bg = ctx.createLinearGradient(0, 0, W * .6, H)
  bg.addColorStop(0, '#1f303a'); bg.addColorStop(.55, '#182024'); bg.addColorStop(1, '#111516')
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)
  const glow = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  }
  glow(W * .85, 0, H * .5, 'rgba(67, 116, 151, .45)')
  glow(0, H, H * .45, 'rgba(134, 214, 217, .16)')
  // Film perforations down both edges.
  ctx.fillStyle = '#0a0d0e'
  ctx.fillRect(0, 0, 70, H); ctx.fillRect(W - 70, 0, 70, H)
  ctx.fillStyle = 'rgba(220, 240, 241, .14)'
  for (let y = 26; y < H - 30; y += 64) { ctx.beginPath(); ctx.roundRect(22, y, 26, 36, 6); ctx.roundRect(W - 48, y, 26, 36, 6); ctx.fill() }
  ctx.strokeStyle = 'rgba(134, 214, 217, .3)'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.roundRect(100, top - 30, W - 200, bottom - top + 60, 18); ctx.stroke()

  ctx.fillStyle = gold; ctx.font = `600 30px ${sans}`
  ctx.fillText(header.kicker, left, top + 70)
  if (header.right) { ctx.textAlign = 'right'; ctx.font = `italic 30px ${serif}`; ctx.fillText(header.right, right, top + 70); ctx.textAlign = 'left' }
  if (header.owner) { ctx.font = `italic 38px ${serif}`; ctx.fillStyle = '#aee4e6'; ctx.fillText('@' + header.owner, left, top + 128) }

  const footerTop = bottom - (story ? 220 : 165)
  ctx.strokeStyle = 'rgba(134, 214, 217, .35)'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(left, footerTop); ctx.lineTo(right, footerTop); ctx.stroke()
  ctx.fillStyle = cream; ctx.font = `italic ${story ? 44 : 38}px ${serif}`
  ctx.fillText(footer.question, left, footerTop + (story ? 75 : 62))
  ctx.fillStyle = muted; ctx.font = `${story ? 30 : 27}px ${sans}`
  ctx.fillText(wrap(ctx, footer.address.replace(/^https?:\/\//, ''), width - 220, 1)[0], left, footerTop + (story ? 130 : 110))
  ctx.textAlign = 'right'; ctx.font = `700 ${story ? 52 : 44}px ${sans}`; ctx.fillStyle = cream
  ctx.fillText('favo', right, footerTop + (story ? 78 : 64))
  ctx.font = `600 ${story ? 22 : 20}px ${sans}`; ctx.fillStyle = gold
  ctx.fillText(footer.detail ?? 'DİZİ', right, footerTop + (story ? 130 : 110))
  ctx.textAlign = 'left'
  return { ctx, story, left, right, width, top, bottom, footerTop }
}

/** priority: lower is more essential; priority 0 is always drawn. */
export type Section = { height: number; priority: number; draw: (y: number) => void }

/** Takes sections from most to least essential while they fit, then draws them centred in reading order. */
export function layoutSections(frame: CardFrame, sections: Section[]) {
  const areaTop = frame.top + 180, areaBottom = frame.footerTop - 30, gap = frame.story ? 48 : 34
  let used = -gap
  const chosen = new Set<Section>()
  for (const section of [...sections].sort((a, b) => a.priority - b.priority)) {
    if (section.priority > 0 && used + gap + section.height > areaBottom - areaTop) continue
    used += gap + section.height; chosen.add(section)
  }
  let y = areaTop + Math.max(0, (areaBottom - areaTop - used) / 2)
  for (const section of sections.filter(s => chosen.has(s))) { section.draw(y); y += section.height + gap }
}

export function toBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Kart oluşturulamadı.')), 'image/png'))
}

export function downloadCard(blob: Blob, fileName: string) {
  const reader = new FileReader()
  // The gateway CSP blocks blob: URLs, so the download link uses a data URL.
  reader.onload = () => {
    const link = document.createElement('a'); link.href = reader.result as string; link.download = fileName
    document.body.append(link); link.click(); link.remove()
  }
  reader.readAsDataURL(blob)
}

function genreBars(frame: CardFrame, genres: { name: string; percent: number }[]): Section {
  const { ctx, story, left, right, width } = frame
  const row = story ? 118 : 86
  return {
    height: genres.length * row, priority: 1,
    draw: y => genres.forEach((genre, i) => {
      const line = y + i * row + 44
      ctx.fillStyle = cream; ctx.font = `38px ${serif}`; ctx.fillText(genre.name, left, line)
      ctx.textAlign = 'right'; ctx.fillStyle = gold; ctx.font = `600 34px ${sans}`; ctx.fillText('%' + genre.percent, right, line); ctx.textAlign = 'left'
      ctx.fillStyle = '#2c363b'; ctx.beginPath(); ctx.roundRect(left, line + 20, width, 14, 7); ctx.fill()
      const bar = ctx.createLinearGradient(left, 0, left + width, 0); bar.addColorStop(0, '#437497'); bar.addColorStop(1, gold)
      ctx.fillStyle = bar; ctx.beginPath(); ctx.roundRect(left, line + 20, Math.max(14, width * genre.percent / 100), 14, 7); ctx.fill()
    }),
  }
}

/** Traits as small admission-ticket stubs. */
function ticketStubs(frame: CardFrame, traits: string[]): Section {
  const { ctx, left, right } = frame
  return {
    height: 90, priority: 4,
    draw: y => {
      let x = left
      ctx.font = `600 25px ${sans}`
      for (const trait of traits) {
        const label = trait.toLocaleUpperCase('tr-TR'), w = ctx.measureText(label).width + 56
        if (x + w > right) break
        ctx.strokeStyle = 'rgba(134, 214, 217, .75)'; ctx.lineWidth = 3; ctx.setLineDash([])
        ctx.beginPath(); ctx.roundRect(x, y + 14, w, 62, 8); ctx.stroke()
        ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(x + 18, y + 20); ctx.lineTo(x + 18, y + 70); ctx.stroke(); ctx.setLineDash([])
        ctx.fillStyle = gold; ctx.fillText(label, x + 34, y + 54)
        x += w + 20
      }
    },
  }
}

/** A film cover with a label and title beside it (signature film, suggestion). */
function filmBeside(frame: CardFrame, film: CardFilm, label: string, note: string | null): Section {
  const { ctx, story, left, right } = frame
  const coverH = story ? 300 : 190, coverW = Math.round(coverH * 2 / 3)
  return {
    height: coverH + 30, priority: 2,
    draw: y => {
      drawFilmCover(ctx, film, left, y + 10, coverW, coverH)
      const textLeft = left + coverW + 40
      ctx.fillStyle = gold; ctx.font = `600 25px ${sans}`; ctx.fillText(label, textLeft, y + 60)
      ctx.fillStyle = cream; ctx.font = `${story ? 50 : 42}px ${serif}`
      const lines = wrap(ctx, film.title, right - textLeft, 2)
      lines.forEach((line, i) => ctx.fillText(line, textLeft, y + 120 + i * (story ? 60 : 50)))
      const detail = note ?? [film.year, film.director].filter(Boolean).join(' · ')
      if (detail) { ctx.fillStyle = muted; ctx.font = `italic 30px ${serif}`; ctx.fillText(wrap(ctx, detail, right - textLeft, 1)[0], textLeft, y + 132 + lines.length * (story ? 60 : 50)) }
    },
  }
}

export type IdentityShare = { title: string | null; watchedCount: number; ratingCount: number; genres: { name: string; percent: number }[];
  strengths: { label: string }[]; traits: string[]; signature: CardFilm | null }

/** The viewer identity card: title, genre shares, what they value, traits and the signature film. */
export async function renderIdentityCard(taste: IdentityShare, nickname: string | null, format: CardFormat, linkProfile: boolean) {
  const canvas = document.createElement('canvas')
  const frame = drawCardFrame(canvas, format,
    { kicker: 'SEYİRCİ KİMLİĞİ', right: '№ ' + String(taste.watchedCount + taste.ratingCount).padStart(3, '0'), owner: nickname },
    { question: 'Sen hangi izleyicisin?', address: nickname && linkProfile ? profileUrl(nickname) : window.location.host, detail: `${taste.watchedCount} İZLENEN · ${taste.ratingCount} PUAN` })
  const { ctx, story, left, width } = frame
  const titleSize = story ? 100 : 78
  ctx.font = `${titleSize}px ${serif}`
  const titleLines = wrap(ctx, taste.title ?? '', width)
  const sections: Section[] = [{
    height: titleLines.length * titleSize * 1.1 + 20, priority: 0,
    draw: y => { ctx.fillStyle = cream; ctx.font = `${titleSize}px ${serif}`; titleLines.forEach((line, i) => ctx.fillText(line, left, y + titleSize * (i + .85) * 1.1)) },
  }]
  if (taste.genres.length) sections.push(genreBars(frame, taste.genres))
  if (taste.strengths.length) sections.push({
    height: 130, priority: 3,
    draw: y => {
      ctx.fillStyle = muted; ctx.font = `italic 32px ${serif}`; ctx.fillText('Sevdiği dizilerde öne çıkan', left, y + 40)
      ctx.fillStyle = cream; ctx.font = `42px ${serif}`; ctx.fillText(wrap(ctx, taste.strengths.map(s => s.label).join(' ve '), width, 1)[0], left, y + 98)
    },
  })
  if (taste.traits.length) sections.push(ticketStubs(frame, taste.traits))
  if (taste.signature) sections.push(filmBeside(frame, taste.signature, 'İMZA DİZİSİ', null))
  layoutSections(frame, sections)
  return toBlob(canvas)
}

export type FilmShare = { kind: 'watching' | 'watched' | 'rating'; film: CardFilm; score: number | null; summary: string | null }

/** "Now watching", "Watched" or "My rating" card for one film, its cover as the hero. */
export async function renderFilmCard(data: FilmShare, nickname: string | null, format: CardFormat, linkProfile: boolean) {
  const canvas = document.createElement('canvas')
  const rating = data.kind === 'rating' && data.score != null
  const frame = drawCardFrame(canvas, format,
    { kicker: rating ? 'PUANIM' : data.kind === 'watched' ? 'İZLEDİM' : 'ŞU AN İZLİYORUM', owner: nickname },
    { question: rating ? 'Sen kaç verirdin?' : data.kind === 'watched' ? 'Sen izledin mi?' : 'Sen ne izliyorsun?', address: nickname && linkProfile ? profileUrl(nickname) : window.location.host })
  const { ctx, story, left, width } = frame
  const centre = left + width / 2
  const coverH = story ? 640 : 400, coverW = Math.round(coverH * 2 / 3)
  const sections: Section[] = [{
    height: coverH + (story ? 200 : 150), priority: 0,
    draw: y => {
      drawFilmCover(ctx, data.film, centre - coverW / 2, y + 10, coverW, coverH)
      const textTop = y + coverH + 40
      ctx.textAlign = 'center'; ctx.fillStyle = cream; ctx.font = `${story ? 58 : 46}px ${serif}`
      const lines = wrap(ctx, data.film.title, width, 2)
      lines.forEach((line, i) => ctx.fillText(line, centre, textTop + (story ? 66 : 52) + i * (story ? 66 : 54)))
      const meta = [data.film.director, data.film.year].filter(Boolean).join(' · ')
      if (meta) { ctx.fillStyle = gold; ctx.font = `italic ${story ? 34 : 30}px ${serif}`; ctx.fillText(meta, centre, textTop + (story ? 80 : 64) + lines.length * (story ? 66 : 54)) }
      ctx.textAlign = 'left'
    },
  }]
  if (rating) sections.push({
    height: story ? 150 : 110, priority: 0,
    draw: y => {
      ctx.textAlign = 'right'; ctx.fillStyle = gold; ctx.font = `${story ? 124 : 90}px ${serif}`
      ctx.fillText(decimal(data.score!), centre + (story ? 50 : 36), y + (story ? 115 : 85))
      ctx.textAlign = 'left'; ctx.fillStyle = muted; ctx.font = `${story ? 44 : 34}px ${serif}`
      ctx.fillText('/ 10', centre + (story ? 70 : 52), y + (story ? 115 : 85))
    },
  })
  if (data.summary) {
    ctx.font = `italic ${story ? 34 : 30}px ${serif}`
    const lines = wrap(ctx, data.summary, width, story ? 4 : 2)
    sections.push({
      height: lines.length * (story ? 48 : 42) + 10, priority: 3,
      draw: y => { ctx.fillStyle = '#cbe3e4'; ctx.font = `italic ${story ? 34 : 30}px ${serif}`; ctx.textAlign = 'center'; lines.forEach((line, i) => ctx.fillText(line, centre, y + 36 + i * (story ? 48 : 42))); ctx.textAlign = 'left' },
    })
  }
  layoutSections(frame, sections)
  return toBlob(canvas)
}

export type CompatibilityShare = { viewer: string | null; other: string; percent: number; label: string | null; sharedGenres: string[]; commonFilms: number; suggestion: CardFilm | null }

/** Blend-style card: the two viewers, the match as a dial, shared genres and one film to take from the other. */
export async function renderCompatibilityCard(data: CompatibilityShare, format: CardFormat, linkViewer: boolean) {
  const canvas = document.createElement('canvas')
  const frame = drawCardFrame(canvas, format, { kicker: 'SEYİRCİ UYUMU' },
    { question: 'Seninle uyumumuz kaç?', address: data.viewer && linkViewer ? profileUrl(data.viewer) : window.location.host, detail: data.commonFilms > 0 ? `${data.commonFilms} ORTAK FİLM` : undefined })
  const { ctx, story, left, width } = frame
  const radius = story ? 170 : 128, centre = left + width / 2
  const sections: Section[] = [{
    height: radius * 2 + (story ? 210 : 170), priority: 0,
    draw: y => {
      ctx.textAlign = 'center'; ctx.fillStyle = '#aee4e6'; ctx.font = `italic ${story ? 44 : 38}px ${serif}`
      ctx.fillText(wrap(ctx, data.viewer ? `@${data.viewer}  ·  @${data.other}` : `@${data.other} ile`, width, 1)[0], centre, y + 40)
      const cy = y + 80 + radius
      ctx.lineCap = 'round'; ctx.strokeStyle = '#2c363b'; ctx.lineWidth = story ? 26 : 20
      ctx.beginPath(); ctx.arc(centre, cy, radius, 0, Math.PI * 2); ctx.stroke()
      const arc = ctx.createLinearGradient(centre - radius, 0, centre + radius, 0); arc.addColorStop(0, '#437497'); arc.addColorStop(1, gold)
      ctx.strokeStyle = arc; ctx.beginPath(); ctx.arc(centre, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(.02, data.percent / 100)); ctx.stroke()
      ctx.fillStyle = cream; ctx.font = `${story ? 150 : 116}px ${serif}`; ctx.fillText('%' + data.percent, centre, cy + (story ? 52 : 40))
      if (data.label) { ctx.fillStyle = gold; ctx.font = `italic ${story ? 54 : 44}px ${serif}`; ctx.fillText(wrap(ctx, data.label, width, 1)[0], centre, cy + radius + (story ? 105 : 85)) }
      ctx.textAlign = 'left'
    },
  }]
  if (data.sharedGenres.length) sections.push({
    height: story ? 130 : 110, priority: 1,
    draw: y => {
      ctx.textAlign = 'center'; ctx.fillStyle = gold; ctx.font = `600 25px ${sans}`; ctx.fillText('ORTAK KANALIMIZ', centre, y + 34)
      ctx.fillStyle = cream; ctx.font = `${story ? 42 : 36}px ${serif}`; ctx.fillText(wrap(ctx, data.sharedGenres.slice(0, 3).join(' · '), width, 1)[0], centre, y + (story ? 95 : 82))
      ctx.textAlign = 'left'
    },
  })
  if (data.suggestion) sections.push(filmBeside(frame, data.suggestion, `@${data.other.toLocaleUpperCase('tr-TR')} ÖNERİYOR`, null))
  layoutSections(frame, sections)
  return toBlob(canvas)
}

export type SummaryShare = { label: string; filmCount: number; hours: string | null; averageScore: number | null; genres: string[]; films: CardFilm[]; favorite: (CardFilm & { score: number | null }) | null }

/** Wrapped-style poster for a month or a year: the count as the hero, a fan of covers, the numbers, top genres, the favourite. */
export async function renderSummaryCard(s: SummaryShare, nickname: string | null, format: CardFormat, linkProfile: boolean) {
  const canvas = document.createElement('canvas')
  const story = format === 'story', k = story ? 1 : .78
  const frame = drawCardFrame(canvas, format, { kicker: `${s.label} İZLEME ÖZETİM`.toLocaleUpperCase('tr-TR'), owner: nickname },
    { question: 'Senin özetin nasıl?', address: nickname && linkProfile ? profileUrl(nickname) : window.location.host })
  const { ctx, footerTop } = frame
  const centre = W / 2
  ctx.textAlign = 'center'
  let y = (story ? 290 : 230) + (story ? 300 : 210)
  ctx.fillStyle = cream; ctx.font = `${story ? 320 : 230}px ${serif}`; ctx.fillText(String(s.filmCount), centre, y)
  y += 82 * k
  ctx.fillStyle = gold; ctx.font = `italic ${Math.round(64 * k)}px ${serif}`; ctx.fillText('dizi izledim', centre, y)

  const picks = s.films.slice(0, 5)
  if (picks.length) {
    const coverH = story ? 400 : 250, coverW = Math.round(coverH * 2 / 3)
    const step = Math.min(coverW * .62, (W - 300 - coverW) / Math.max(1, picks.length - 1))
    const start = centre - (step * (picks.length - 1) + coverW) / 2, top = y + (story ? 90 : 45), middle = (picks.length - 1) / 2
    picks.map((_, i) => i).sort((a, b) => Math.abs(b - middle) - Math.abs(a - middle)).forEach(i => {
      ctx.save(); ctx.translate(start + i * step + coverW / 2, top + coverH / 2 + (i - middle) ** 2 * 10); ctx.rotate((i - middle) * .08)
      ctx.textAlign = 'left'; drawFilmCover(ctx, picks[i], -coverW / 2, -coverH / 2, coverW, coverH); ctx.restore()
    })
    ctx.textAlign = 'center'
    y = top + coverH + (story ? 60 : 30)
  }

  const stats = [s.hours ? [s.hours, 'saat ekran'] : null, s.averageScore != null ? [decimal(s.averageScore), 'ortalama puan'] : null,
    s.genres.length ? [String(s.genres.length), 'tür'] : null].filter((x): x is string[] => !!x)
  if (stats.length) {
    y += story ? 90 : 70
    const colW = (W - 300) / stats.length
    stats.forEach(([value, unit], i) => {
      const x = 150 + colW * (i + .5)
      ctx.fillStyle = cream; ctx.font = `${Math.round(78 * k)}px ${serif}`; ctx.fillText(value, x, y)
      ctx.fillStyle = muted; ctx.font = `${Math.round(30 * k)}px ${sans}`; ctx.fillText(unit, x, y + 46 * k)
    })
    y += 46 * k
  }
  const genres = s.genres.slice(0, 3)
  if (genres.length && y + (story ? 150 : 110) < footerTop - (story ? 120 : 30)) {
    y += story ? 80 : 46
    const size = Math.round(32 * k)
    ctx.textAlign = 'left'; ctx.font = `${size}px ${serif}`
    const widths = genres.map(g => ctx.measureText(g).width + size * 1.4), gap = 16
    let x = centre - (widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1)) / 2
    genres.forEach((g, i) => {
      const h = size * 1.9
      ctx.strokeStyle = 'rgba(134, 214, 217, .7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x, y, widths[i], h, h / 2); ctx.stroke()
      ctx.fillStyle = cream; ctx.fillText(g, x + size * .7, y + h * .66); x += widths[i] + gap
    })
    ctx.textAlign = 'center'
    y += size * 1.9
  }
  if (story && s.favorite && y + 140 < footerTop - 40) {
    y += 110
    ctx.fillStyle = gold; ctx.font = `italic 34px ${serif}`; ctx.fillText('En sevdiğim', centre, y)
    ctx.fillStyle = cream; ctx.font = `44px ${serif}`
    ctx.fillText(wrap(ctx, s.favorite.title + (s.favorite.score != null ? ` · ${decimal(s.favorite.score)}/10` : ''), W - 300, 1)[0], centre, y + 60)
  }
  ctx.textAlign = 'left'
  return toBlob(canvas)
}

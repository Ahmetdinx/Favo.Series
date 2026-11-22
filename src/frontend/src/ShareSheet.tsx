import { useEffect, useRef, useState } from 'react'
import { downloadCard, type CardFormat } from './share'
import './share-sheet.css'

const formats: { id: CardFormat; label: string; hint: string }[] = [
  { id: 'story', label: 'Hikâye', hint: '9:16 · Instagram, WhatsApp durum' },
  { id: 'post', label: 'Gönderi', hint: '4:5 · akış ve X' },
]

type Props = {
  open: boolean
  onClose: () => void
  title: string
  /** Accessible description of the card for the preview image. */
  alt: string
  /** Draws the card; null while its data is still loading. */
  render: ((format: CardFormat) => Promise<Blob>) | null
  shareText: string
  link?: string | null
  fileName: string
  note: string
}

/** The Books share sheet in cinema colours: pick story or post, see the exact image, then share, download or copy the link. */
export default function ShareSheet({ open, onClose, title, alt, render, shareText, link, fileName, note }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [format, setFormat] = useState<CardFormat>('story')
  const [image, setImage] = useState<{ blob: Blob; url: string; format: CardFormat } | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) { element.showModal(); setMessage('') }
    if (!open && element.open) element.close()
  }, [open])

  useEffect(() => {
    if (!open || !render) return
    let active = true
    void render(format).then(async blob => {
      // A data URL: the gateway CSP allows data: images but not blob: URLs.
      const url = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.onerror = () => reject(r.error); r.readAsDataURL(blob) })
      if (active) setImage({ blob, url, format })
    }).catch(() => { if (active) setMessage('Kart hazırlanamadı.') })
    return () => { active = false }
  }, [open, render, format])

  const ready = image?.format === format
  async function share() {
    if (!image) return
    setBusy(true); setMessage('')
    try {
      const file = new File([image.blob], fileName, { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title, text: link ? `${shareText} ${link}` : shareText }); setMessage('Paylaşıldı.'); return }
        catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return }
      }
      downloadCard(image.blob, fileName)
      setMessage('Kart indirildi. Hikâyene ya da gönderine ekleyebilirsin.')
    } finally { setBusy(false) }
  }
  async function copyLink() {
    if (!link) return
    try { await navigator.clipboard.writeText(link); setMessage('Link kopyalandı.') } catch { setMessage('Link kopyalanamadı.') }
  }

  return <dialog ref={dialog} className="share-sheet" aria-labelledby="share-sheet-title" onClose={onClose}
    onClick={event => { if (event.target === dialog.current) onClose() }}>
    <div className="share-sheet-panel">
      <header><h2 id="share-sheet-title">{title}</h2><button type="button" className="share-sheet-close" aria-label="Kapat" onClick={onClose}>✕</button></header>
      <div className="share-sheet-formats" role="radiogroup" aria-label="Görsel biçimi">
        {formats.map(option => <button key={option.id} type="button" role="radio" aria-checked={format === option.id} onClick={() => setFormat(option.id)}>
          <strong>{option.label}</strong><span>{option.hint}</span></button>)}
      </div>
      <div className={'share-sheet-preview ' + format} aria-busy={!ready}>
        {ready ? <img src={image.url} alt={`${alt} (${format === 'story' ? 'hikâye' : 'gönderi'} önizlemesi)`} /> : <span role="status">Kart hazırlanıyor…</span>}
      </div>
      <div className="share-sheet-actions">
        <button type="button" className="primary" disabled={!ready || busy} onClick={() => void share()}>Paylaş</button>
        <button type="button" className="outline-button" disabled={!ready} onClick={() => image && downloadCard(image.blob, fileName)}>İndir</button>
        {link && <button type="button" className="outline-button" onClick={() => void copyLink()}>Linki kopyala</button>}
      </div>
      {message && <p className="share-sheet-message" role="status">{message}</p>}
      <p className="share-sheet-note">{note}</p>
    </div>
  </dialog>
}

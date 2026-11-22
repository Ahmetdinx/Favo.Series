/**
 * Ad and campaign links (UTM tags), shared by every Favo app through one browser key. This file is the same in Favo,
 * Favo.Books, Favo.Movie and Favo.Series: an arrival on any of them is reported once per campaign per day, and a later sign-up on the
 * Books register page or with Google carries the campaign. No account, address or cookie is involved.
 *
 * The same call also remembers which app this browser opened last (`favo:last-app`), so the portal can feature its card.
 */
const campaignKey = 'favo:campaign'
const seenKey = 'favo:campaign-seen'
const lastAppKey = 'favo:last-app'
const campaignTtl = 30 * 24 * 60 * 60 * 1000

export type Campaign = { source: string; medium?: string; name?: string; content?: string }
export type CampaignApp = 'portal' | 'kitap' | 'film' | 'dizi'

function cut(value: string | null) {
  const text = value?.trim()
  return text ? text.slice(0, 64) : undefined
}

function today() {
  const now = new Date()
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
}

/** Reads utm_source/utm_medium/utm_campaign/utm_content from the address; the newest campaign link wins. */
export function captureCampaign(search: string, app: CampaignApp) {
  if (app !== 'portal') try { localStorage.setItem(lastAppKey, app) } catch { /* storage is optional */ }
  const params = new URLSearchParams(search)
  const source = cut(params.get('utm_source'))
  if (!source) return
  const campaign: Campaign = { source, medium: cut(params.get('utm_medium')), name: cut(params.get('utm_campaign')), content: cut(params.get('utm_content')) }
  try { localStorage.setItem(campaignKey, JSON.stringify({ ...campaign, at: Date.now() })) } catch { /* storage is optional */ }
  const id = [campaign.source, campaign.medium, campaign.name, campaign.content].join('|')
  let seen: { day?: string; ids?: string[] } = {}
  try { seen = JSON.parse(localStorage.getItem(seenKey) ?? '{}') as typeof seen } catch { /* start fresh */ }
  const ids = seen.day === today() ? seen.ids ?? [] : []
  if (ids.includes(id)) return
  try { localStorage.setItem(seenKey, JSON.stringify({ day: today(), ids: [...ids, id].slice(-20) })) } catch { /* may count again */ }
  void fetch('/api/identity/campaign-visits', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
    body: JSON.stringify({ campaign, app }),
  }).catch(() => undefined)
}

/** The campaign to send with a sign-up, if the visitor arrived through one in the last 30 days. */
export function campaignRequestField(): { campaign?: Campaign } {
  try {
    const value = JSON.parse(localStorage.getItem(campaignKey) ?? 'null') as (Campaign & { at?: number }) | null
    if (!value?.source || !value.at || Date.now() - value.at > campaignTtl) return {}
    return { campaign: { source: value.source, medium: value.medium, name: value.name, content: value.content } }
  } catch { return {} }
}

/** The app this browser opened last; the portal shows its card large. */
export function lastApp(): Exclude<CampaignApp, 'portal'> | undefined {
  try {
    const value = localStorage.getItem(lastAppKey)
    return value === 'kitap' || value === 'film' || value === 'dizi' ? value : undefined
  } catch { return undefined }
}

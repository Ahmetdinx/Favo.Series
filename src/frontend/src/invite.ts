/**
 * Invitations and the first-run guide, shared with Books through the same browser storage.
 * The key and shape of "favo:invited-by" are the ones the Books register page sends to the account service,
 * so a visitor who arrives through a Film link and signs up is credited to the viewer who shared it.
 */
const inviteKey = 'favo:invited-by'
const inviteTtl = 24 * 60 * 60 * 1000
const seenKey = (userId: string) => `favo-dizi:onboarding-seen:${userId}`

/** Sources the account service accepts; Film cards use "kart", the match card "uyum". */
export type InviteSource = 'kart' | 'link' | 'uyum' | 'profil'

export function rememberInvite(nickname: string, source: InviteSource = 'profil') {
  try { localStorage.setItem(inviteKey, JSON.stringify({ nickname, source, at: Date.now() })) } catch { /* optional */ }
}

/** Records ?ref=<nickname>&src=<source> from a shared link, so a later sign-up is credited to that viewer. */
export function captureInviteFromUrl(search: string) {
  const params = new URLSearchParams(search)
  const ref = params.get('ref')
  const src = params.get('src')
  if (ref && /^[a-zA-Z][a-zA-Z0-9_]{2,23}$/.test(ref)) rememberInvite(ref, src === 'kart' || src === 'uyum' || src === 'profil' ? src : 'link')
}

export function pendingInvite(): string | null {
  try {
    const value = JSON.parse(localStorage.getItem(inviteKey) ?? 'null') as { nickname?: string; at?: number } | null
    return value?.nickname && value.at && Date.now() - value.at < inviteTtl ? value.nickname : null
  } catch { return null }
}

export function clearInvite() { try { localStorage.removeItem(inviteKey) } catch { /* optional */ } }

export function hasSeenOnboarding(userId: string) { try { return localStorage.getItem(seenKey(userId)) === '1' } catch { return false } }
export function markOnboardingSeen(userId: string) { try { localStorage.setItem(seenKey(userId), '1') } catch { /* the home card simply stays offered */ } }

/** Sign-up happens on the shared Favo register page; afterwards the new viewer comes back to the Film guide. */
export const registerUrl = '/kitap/register?donus=' + encodeURIComponent(import.meta.env.BASE_URL + 'baslangic')

/**
 * Ingest platform JWT from URL hash (#access_token=...) into localStorage.
 * Strips access_token from the visible URL without logging the token.
 */
export function ingestAccessTokenFromHash() {
  if (typeof window === 'undefined') {
    return false
  }

  const { hash, pathname, search } = window.location
  if (!hash || hash.length <= 1) {
    return false
  }

  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const token = params.get('access_token')
  if (!token) {
    return false
  }

  localStorage.setItem('auth-token', token)

  params.delete('access_token')
  const remaining = params.toString()
  const nextUrl = `${pathname}${search}${remaining ? `#${remaining}` : ''}`
  window.history.replaceState(null, '', nextUrl)

  return true
}

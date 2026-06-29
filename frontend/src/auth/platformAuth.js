export const AUTH_TOKEN_STORAGE_KEY = 'auth_token'
const LEGACY_AUTH_TOKEN_KEY = 'auth-token'

export function getAuthToken() {
  if (typeof window === 'undefined') {
    return ''
  }

  const canonical = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
  if (canonical) {
    return canonical
  }

  const legacy = localStorage.getItem(LEGACY_AUTH_TOKEN_KEY)
  if (legacy) {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, legacy)
    localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY)
    return legacy
  }

  return ''
}

export function setAuthToken(token) {
  if (typeof window === 'undefined' || !token) {
    return
  }
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token)
  localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY)
}

export function clearAuthToken() {
  if (typeof window === 'undefined') {
    return
  }
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
  localStorage.removeItem(LEGACY_AUTH_TOKEN_KEY)
}

export function hasAuthToken() {
  return Boolean(getAuthToken())
}

/**
 * Explicit local-dev override only. Never used in production builds.
 */
export function getDevLearnerOverrideId() {
  if (!import.meta.env.DEV) {
    return null
  }
  const forced = import.meta.env.VITE_FORCE_LEARNER_ID
  return typeof forced === 'string' && forced.trim() ? forced.trim() : null
}

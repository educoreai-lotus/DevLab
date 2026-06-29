const AUTH_TOKEN_KEY = 'auth-token'

export function getAuthToken() {
  if (typeof window === 'undefined') {
    return ''
  }
  return localStorage.getItem(AUTH_TOKEN_KEY) || ''
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

export { AUTH_TOKEN_KEY }

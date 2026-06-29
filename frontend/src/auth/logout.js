import { clearAuthToken } from './platformAuth.js'
import { useAuthStore } from '../store/authStore.js'

export const navigation = {
  redirect(url) {
    if (typeof window !== 'undefined') {
      window.location.href = url
    }
  }
}

export const DEVLAB_AUTH_STORAGE_KEYS = [
  'auth_token',
  'auth-token',
  'authToken',
  'accessToken',
  'token',
  'user_id',
  'auth-storage'
]

/**
 * Invalidate the central nAuth session via cookie-based logout.
 */
export async function callNAuthLogout() {
  const baseUrl = import.meta.env.VITE_NAUTH_BASE_URL

  if (!baseUrl || typeof baseUrl !== 'string' || !baseUrl.trim()) {
    throw new Error('VITE_NAUTH_BASE_URL is not configured')
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/auth/logout`

  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`nAuth logout failed with status ${response.status}`)
  }
}

/**
 * Clear all DevLab-local auth state.
 */
export function clearDevLabAuthState() {
  if (typeof window !== 'undefined') {
    clearAuthToken()

    DEVLAB_AUTH_STORAGE_KEYS.forEach((key) => {
      localStorage.removeItem(key)
    })

    if (window.APP_USER && typeof window.APP_USER === 'object') {
      window.APP_USER.id = 'anonymous'
      window.APP_USER.token = ''
    }
  }

  useAuthStore.setState({ user: null, error: null, isLoading: false })

  if (typeof useAuthStore.persist?.clearStorage === 'function') {
    useAuthStore.persist.clearStorage()
  }
}

/**
 * Build the nAuth frontend login URL.
 */
export function getNAuthLoginUrl() {
  const frontendUrl = import.meta.env.VITE_NAUTH_FRONTEND_URL

  if (!frontendUrl || typeof frontendUrl !== 'string' || !frontendUrl.trim()) {
    throw new Error('VITE_NAUTH_FRONTEND_URL is not configured')
  }

  return `${frontendUrl.replace(/\/+$/, '')}/login`
}

/**
 * Redirect to the nAuth login page in the same tab.
 */
export function redirectToNAuthLogin() {
  navigation.redirect(getNAuthLoginUrl())
}

/**
 * Perform platform logout: nAuth session invalidation, local cleanup, redirect.
 */
export async function logout() {
  let centralLogoutSucceeded = false

  try {
    await callNAuthLogout()
    centralLogoutSucceeded = true
  } catch (error) {
    console.error(
      '[DevLab Logout] nAuth logout failed; central session may still be active. Clearing local auth state anyway.',
      error
    )
  } finally {
    clearDevLabAuthState()

    try {
      redirectToNAuthLogin()
    } catch (redirectError) {
      navigation.redirect('/sign-in-required')
    }
  }

  return { centralLogoutSucceeded }
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const headerSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../components/layout/Header.jsx'),
  'utf8'
)

describe('Header logout wiring', () => {
  it('imports and invokes platform logout helper on click', () => {
    expect(headerSource).toContain("from '../../auth/logout.js'")
    expect(headerSource).toContain('performPlatformLogout')
    expect(headerSource).toContain('onClick={handleLogout}')
  })
})

describe('platform logout helper', () => {
  const fetchMock = vi.fn()
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('VITE_NAUTH_BASE_URL', 'https://nauth.example.com')
    vi.stubEnv('VITE_NAUTH_FRONTEND_URL', 'https://nauth-frontend.example.com')
    localStorage.clear()
    global.fetch = fetchMock
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    consoleErrorSpy.mockClear()
  })

  it('callNAuthLogout sends POST to nAuth /auth/logout without Authorization or body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 })

    const { callNAuthLogout } = await import('./logout.js')
    await callNAuthLogout()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://nauth.example.com/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      }
    })

    const [, options] = fetchMock.mock.calls[0]
    expect(options.body).toBeUndefined()
    expect(options.headers.Authorization).toBeUndefined()
  })

  it('callNAuthLogout strips trailing slash from base URL', async () => {
    vi.stubEnv('VITE_NAUTH_BASE_URL', 'https://nauth.example.com/')
    fetchMock.mockResolvedValue({ ok: true, status: 200 })

    const { callNAuthLogout } = await import('./logout.js')
    await callNAuthLogout()

    expect(fetchMock.mock.calls[0][0]).toBe('https://nauth.example.com/auth/logout')
  })

  it('clearDevLabAuthState clears all DevLab auth storage keys', async () => {
    const { clearDevLabAuthState, DEVLAB_AUTH_STORAGE_KEYS } = await import('./logout.js')

    DEVLAB_AUTH_STORAGE_KEYS.forEach((key) => {
      localStorage.setItem(key, 'value')
    })
    window.APP_USER = { id: 'user-1', token: 'secret', tenantId: 'devlab' }

    clearDevLabAuthState()

    DEVLAB_AUTH_STORAGE_KEYS.forEach((key) => {
      expect(localStorage.getItem(key)).toBeNull()
    })
    expect(window.APP_USER.id).toBe('anonymous')
    expect(window.APP_USER.token).toBe('')
  })

  it('getNAuthLoginUrl returns frontend login URL without trailing slash issues', async () => {
    const { getNAuthLoginUrl } = await import('./logout.js')
    expect(getNAuthLoginUrl()).toBe('https://nauth-frontend.example.com/login')

    vi.stubEnv('VITE_NAUTH_FRONTEND_URL', 'https://nauth-frontend.example.com/')
    vi.resetModules()
    const { getNAuthLoginUrl: getLoginUrl } = await import('./logout.js')
    expect(getLoginUrl()).toBe('https://nauth-frontend.example.com/login')
  })

  it('logout success path clears state and redirects to nAuth login', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
    localStorage.setItem('auth_token', 'jwt-value')

    const redirectMock = vi.fn()
    const logoutModule = await import('./logout.js')
    logoutModule.navigation.redirect = redirectMock

    const result = await logoutModule.logout()

    expect(result).toEqual({ centralLogoutSucceeded: true })
    expect(localStorage.getItem('auth_token')).toBeNull()
    expect(redirectMock).toHaveBeenCalledWith('https://nauth-frontend.example.com/login')
  })

  it('logout nAuth failure path still clears state and redirects', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    localStorage.setItem('auth_token', 'jwt-value')

    const redirectMock = vi.fn()
    const logoutModule = await import('./logout.js')
    logoutModule.navigation.redirect = redirectMock

    const result = await logoutModule.logout()

    expect(result).toEqual({ centralLogoutSucceeded: false })
    expect(localStorage.getItem('auth_token')).toBeNull()
    expect(redirectMock).toHaveBeenCalledWith('https://nauth-frontend.example.com/login')
    expect(consoleErrorSpy).toHaveBeenCalled()
    const errorArgs = consoleErrorSpy.mock.calls[0].join(' ')
    expect(errorArgs).not.toContain('jwt-value')
  })

  it('logout redirects to /sign-in-required when frontend URL is missing', async () => {
    vi.stubEnv('VITE_NAUTH_FRONTEND_URL', '')
    fetchMock.mockResolvedValue({ ok: true, status: 200 })

    const redirectMock = vi.fn()
    vi.resetModules()
    const logoutModule = await import('./logout.js')
    logoutModule.navigation.redirect = redirectMock

    await logoutModule.logout()

    expect(redirectMock).toHaveBeenCalledWith('/sign-in-required')
  })
})

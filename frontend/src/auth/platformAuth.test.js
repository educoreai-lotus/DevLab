import { describe, it, expect, beforeEach } from 'vitest'
import {
  AUTH_TOKEN_STORAGE_KEY,
  clearAuthToken,
  getAuthToken,
  setAuthToken
} from './platformAuth.js'

describe('platformAuth token storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores and reads canonical auth_token key', () => {
    setAuthToken('canonical-jwt')
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('canonical-jwt')
    expect(getAuthToken()).toBe('canonical-jwt')
  })

  it('prefers auth_token over legacy auth-token', () => {
    localStorage.setItem('auth-token', 'legacy-jwt')
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'canonical-jwt')

    expect(getAuthToken()).toBe('canonical-jwt')
  })

  it('migrates legacy auth-token to auth_token on read', () => {
    localStorage.setItem('auth-token', 'legacy-jwt')

    expect(getAuthToken()).toBe('legacy-jwt')
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('legacy-jwt')
    expect(localStorage.getItem('auth-token')).toBeNull()
  })

  it('clears both canonical and legacy keys', () => {
    setAuthToken('token')
    localStorage.setItem('auth-token', 'legacy')

    clearAuthToken()

    expect(getAuthToken()).toBe('')
  })
})

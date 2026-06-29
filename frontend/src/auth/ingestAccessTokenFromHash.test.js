import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ingestAccessTokenFromHash } from './ingestAccessTokenFromHash.js'
import { AUTH_TOKEN_STORAGE_KEY } from './platformAuth.js'

describe('ingestAccessTokenFromHash', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/dashboard')
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('stores access_token from hash in localStorage auth_token', () => {
    window.history.replaceState(null, '', '/dashboard#access_token=test-jwt-token')

    const ingested = ingestAccessTokenFromHash()

    expect(ingested).toBe(true)
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('test-jwt-token')
  })

  it('removes access_token from the visible URL after ingestion', () => {
    window.history.replaceState(null, '', '/dashboard?tab=competitions#access_token=test-jwt-token')

    ingestAccessTokenFromHash()

    expect(window.location.pathname).toBe('/dashboard')
    expect(window.location.search).toBe('?tab=competitions')
    expect(window.location.hash).toBe('')
  })

  it('returns false when hash has no access_token', () => {
    window.history.replaceState(null, '', '/dashboard#other=value')

    const ingested = ingestAccessTokenFromHash()

    expect(ingested).toBe(false)
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('does not read access_token from query params', () => {
    window.history.replaceState(null, '', '/dashboard?access_token=query-jwt')

    const ingested = ingestAccessTokenFromHash()

    expect(ingested).toBe(false)
    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull()
  })
})

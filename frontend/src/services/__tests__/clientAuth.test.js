import { describe, it, expect, vi, beforeEach } from 'vitest'
import axios from 'axios'
import { AUTH_TOKEN_STORAGE_KEY } from '../../auth/platformAuth.js'

const requestInterceptor = vi.fn((config) => config)
const responseSuccessInterceptor = vi.fn((response) => response)
const responseErrorInterceptor = vi.fn((error) => Promise.reject(error))

vi.mock('axios', () => {
  const create = vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    interceptors: {
      request: { use: requestInterceptor },
      response: {
        use: vi.fn((onSuccess, onError) => {
          responseSuccessInterceptor.mockImplementation(onSuccess)
          responseErrorInterceptor.mockImplementation(onError)
        })
      }
    }
  }))

  return {
    default: { create }
  }
})

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn()
  }
}))

describe('api client authorization header', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    requestInterceptor.mockClear()
    responseSuccessInterceptor.mockClear()
    responseErrorInterceptor.mockClear()
  })

  it('attaches Authorization Bearer from auth_token', async () => {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'platform-jwt')

    await import('../api/client.js')

    expect(requestInterceptor).toHaveBeenCalled()
    const interceptor = requestInterceptor.mock.calls[0][0]
    const config = interceptor({ headers: {} })

    expect(config.headers.Authorization).toBe('Bearer platform-jwt')
  })

  it('falls back to legacy auth-token when auth_token is missing', async () => {
    localStorage.setItem('auth-token', 'legacy-jwt')

    await import('../api/client.js')

    const interceptor = requestInterceptor.mock.calls[0][0]
    const config = interceptor({ headers: {} })

    expect(config.headers.Authorization).toBe('Bearer legacy-jwt')
  })

  it('stores rotated X-New-Access-Token to auth_token', async () => {
    await import('../api/client.js')

    responseSuccessInterceptor({
      headers: { 'x-new-access-token': 'rotated-jwt' }
    })

    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe('rotated-jwt')
  })

  it('clears auth token on 401 responses', async () => {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, 'platform-jwt')

    await import('../api/client.js')

    await expect(
      responseErrorInterceptor({ response: { status: 401 } })
    ).rejects.toBeDefined()

    expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull()
  })
})

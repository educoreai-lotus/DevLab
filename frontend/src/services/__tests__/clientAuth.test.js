import { describe, it, expect, vi, beforeEach } from 'vitest'
import axios from 'axios'

const requestInterceptor = vi.fn((config) => config)

vi.mock('axios', () => {
  const create = vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    interceptors: {
      request: { use: requestInterceptor },
      response: { use: vi.fn() }
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
  })

  it('attaches Authorization Bearer from auth-token', async () => {
    localStorage.setItem('auth-token', 'platform-jwt')

    await import('../api/client.js')

    expect(requestInterceptor).toHaveBeenCalled()
    const interceptor = requestInterceptor.mock.calls[0][0]
    const config = interceptor({ headers: {} })

    expect(config.headers.Authorization).toBe('Bearer platform-jwt')
  })
})

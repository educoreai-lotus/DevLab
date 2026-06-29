import { describe, it, expect, vi, beforeEach } from 'vitest'

const axiosInstance = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  patch: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() }
  }
}

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => axiosInstance)
  }
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn()
  }
}))

describe('API Client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('makes GET request', async () => {
    const mockResponse = { data: { success: true, data: 'test' } }
    axiosInstance.get.mockResolvedValue(mockResponse)

    const { apiClient } = await import('../api/client.js')
    const result = await apiClient.get('/test')
    expect(result).toEqual(mockResponse.data)
  })

  it('makes POST request', async () => {
    const mockResponse = { data: { success: true, data: 'created' } }
    axiosInstance.post.mockResolvedValue(mockResponse)

    const { apiClient } = await import('../api/client.js')
    const result = await apiClient.post('/test', { data: 'test' })
    expect(result).toEqual(mockResponse.data)
  })

  it('handles errors', async () => {
    const mockError = new Error('Network error')
    axiosInstance.get.mockRejectedValue(mockError)

    const { apiClient } = await import('../api/client.js')
    await expect(apiClient.get('/test')).rejects.toThrow('Network error')
  })
})

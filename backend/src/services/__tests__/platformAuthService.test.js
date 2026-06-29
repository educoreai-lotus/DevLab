/**
 * @jest-environment node
 */

import { jest } from '@jest/globals'

const axiosPost = jest.fn()

jest.unstable_mockModule('axios', () => ({
  default: {
    post: axiosPost
  }
}))

const {
  validatePlatformAccessToken,
  extractCoordinatorValidationResult
} = await import('../platformAuthService.js')

describe('platformAuthService', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    axiosPost.mockReset()
    process.env.COORDINATOR_URL = 'https://coordinator.example.com'
    process.env.AUTH_REQUESTER_SERVICE = 'devlab-service'
    process.env.AUTH_VALIDATION_TIMEOUT_MS = '30000'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('extractCoordinatorValidationResult', () => {
    it('prefers data.response', () => {
      const result = extractCoordinatorValidationResult({
        response: { valid: true, directory_user_id: 'u1' }
      })
      expect(result).toEqual({ valid: true, directory_user_id: 'u1' })
    })

    it('prefers data.data.response', () => {
      const result = extractCoordinatorValidationResult({
        data: { response: { valid: true, directory_user_id: 'u1' } }
      })
      expect(result).toEqual({ valid: true, directory_user_id: 'u1' })
    })

    it('falls back to data.data when valid exists', () => {
      const result = extractCoordinatorValidationResult({
        data: { valid: true, directory_user_id: 'u1' }
      })
      expect(result).toEqual({ valid: true, directory_user_id: 'u1' })
    })

    it('falls back to top-level data when valid exists', () => {
      const result = extractCoordinatorValidationResult({
        valid: true,
        directory_user_id: 'u1'
      })
      expect(result).toEqual({ valid: true, directory_user_id: 'u1' })
    })
  })

  describe('validatePlatformAccessToken', () => {
    it('validates via POST /request with unsigned body', async () => {
      axiosPost.mockResolvedValue({
        status: 200,
        data: {
          response: {
            valid: true,
            directory_user_id: 'u1',
            organization_id: 'org-1',
            primary_role: 'EMPLOYEE'
          }
        }
      })

      const result = await validatePlatformAccessToken('jwt-token', {
        route: '/api/auth/context',
        method: 'GET'
      })

      expect(result.directory_user_id).toBe('u1')
      expect(axiosPost).toHaveBeenCalledTimes(1)

      const [url, body, config] = axiosPost.mock.calls[0]
      expect(url).toBe('https://coordinator.example.com/request')
      expect(url).not.toContain('/api/request')
      expect(body.requester_service).toBe('devlab-service')
      expect(body.payload.access_token).toBe('jwt-token')
      expect(body.payload.route).toBe('/api/auth/context')
      expect(body.payload.method).toBe('GET')
      expect(config.headers).toEqual({ 'Content-Type': 'application/json' })
      expect(config.headers.Authorization).toBeUndefined()
      expect(config.headers['X-Signature']).toBeUndefined()
    })

    it('parses nested data.data.response shape', async () => {
      axiosPost.mockResolvedValue({
        status: 200,
        data: {
          data: {
            response: {
              valid: true,
              directory_user_id: 'u1'
            }
          }
        }
      })

      const result = await validatePlatformAccessToken('jwt-token')
      expect(result.directory_user_id).toBe('u1')
    })

    it('throws 401 when valid is false', async () => {
      axiosPost.mockResolvedValue({
        status: 200,
        data: { response: { valid: false, reason: 'expired' } }
      })

      await expect(validatePlatformAccessToken('jwt-token')).rejects.toMatchObject({
        status: 401,
        message: 'expired'
      })
    })

    it('throws 401 when directory_user_id is missing', async () => {
      axiosPost.mockResolvedValue({
        status: 200,
        data: { response: { valid: true } }
      })

      await expect(validatePlatformAccessToken('jwt-token')).rejects.toMatchObject({
        status: 401
      })
    })

    it('throws 503 when Coordinator is unavailable', async () => {
      axiosPost.mockRejectedValue(new Error('network down'))

      await expect(validatePlatformAccessToken('jwt-token')).rejects.toMatchObject({
        status: 503
      })
    })

    it('throws 503 when Coordinator returns 5xx', async () => {
      axiosPost.mockResolvedValue({ status: 502, data: {} })

      await expect(validatePlatformAccessToken('jwt-token')).rejects.toMatchObject({
        status: 503
      })
    })
  })
})

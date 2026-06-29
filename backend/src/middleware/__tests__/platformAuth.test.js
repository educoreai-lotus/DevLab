import { jest } from '@jest/globals'

const validatePlatformAccessToken = jest.fn()

jest.unstable_mockModule('../../services/platformAuthService.js', () => ({
  validatePlatformAccessToken
}))

const { authenticatePlatformUser } = await import('../platformAuth.js')

const createRes = () => {
  const res = {}
  res.status = jest.fn(() => res)
  res.json = jest.fn(() => res)
  res.setHeader = jest.fn(() => res)
  return res
}

describe('authenticatePlatformUser', () => {
  beforeEach(() => {
    validatePlatformAccessToken.mockReset()
  })

  it('returns 401 when Authorization header is missing', async () => {
    const req = { headers: {}, originalUrl: '/api/auth/context', method: 'GET' }
    const res = createRes()
    const next = jest.fn()

    await authenticatePlatformUser(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Access token required'
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when validation fails', async () => {
    validatePlatformAccessToken.mockRejectedValue(
      Object.assign(new Error('Invalid or expired token'), { status: 401 })
    )

    const req = {
      headers: { authorization: 'Bearer bad-token' },
      originalUrl: '/api/auth/context',
      method: 'GET'
    }
    const res = createRes()
    const next = jest.fn()

    await authenticatePlatformUser(req, res, next)

    expect(validatePlatformAccessToken).toHaveBeenCalledWith('bad-token', {
      route: '/api/auth/context',
      method: 'GET'
    })
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('maps directory_user_id to req.user.directoryUserId', async () => {
    validatePlatformAccessToken.mockResolvedValue({
      directory_user_id: 'dir-123',
      organization_id: 'org-1',
      primary_role: 'EMPLOYEE',
      is_trainer: false,
      is_system_admin: false
    })

    const req = {
      headers: { authorization: 'Bearer good-token' },
      originalUrl: '/api/competitions/pending/me',
      method: 'GET'
    }
    const res = createRes()
    const next = jest.fn()

    await authenticatePlatformUser(req, res, next)

    expect(req.user).toEqual({
      directoryUserId: 'dir-123',
      userId: 'dir-123',
      id: 'dir-123',
      organizationId: 'org-1',
      primaryRole: 'EMPLOYEE',
      isTrainer: false,
      isSystemAdmin: false,
      role: 'employee',
      source: 'coordinator-nauth'
    })
    expect(next).toHaveBeenCalled()
  })

  it('returns 401 when directory_user_id is missing after validation', async () => {
    validatePlatformAccessToken.mockResolvedValue({
      valid: true,
      organization_id: 'org-1'
    })

    const req = {
      headers: { authorization: 'Bearer good-token' },
      originalUrl: '/api/auth/context',
      method: 'GET'
    }
    const res = createRes()
    const next = jest.fn()

    await authenticatePlatformUser(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('sets X-New-Access-Token when Coordinator rotates token', async () => {
    validatePlatformAccessToken.mockResolvedValue({
      directory_user_id: 'dir-123',
      new_access_token: 'rotated-jwt'
    })

    const req = {
      headers: { authorization: 'Bearer good-token' },
      originalUrl: '/api/auth/context',
      method: 'GET'
    }
    const res = createRes()
    const next = jest.fn()

    await authenticatePlatformUser(req, res, next)

    expect(res.setHeader).toHaveBeenCalledWith('X-New-Access-Token', 'rotated-jwt')
    expect(next).toHaveBeenCalled()
  })

  it('returns 503 when Coordinator validation is unavailable', async () => {
    validatePlatformAccessToken.mockRejectedValue(
      Object.assign(new Error('Platform authentication is unavailable'), { status: 503 })
    )

    const req = {
      headers: { authorization: 'Bearer good-token' },
      originalUrl: '/api/auth/context',
      method: 'GET'
    }
    const res = createRes()
    const next = jest.fn()

    await authenticatePlatformUser(req, res, next)

    expect(res.status).toHaveBeenCalledWith(503)
    expect(next).not.toHaveBeenCalled()
  })
})

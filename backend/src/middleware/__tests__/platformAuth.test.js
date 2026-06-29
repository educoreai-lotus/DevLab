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
  return res
}

describe('authenticatePlatformUser', () => {
  beforeEach(() => {
    validatePlatformAccessToken.mockReset()
  })

  it('returns 401 when Authorization header is missing', async () => {
    const req = { headers: {} }
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

    const req = { headers: { authorization: 'Bearer bad-token' } }
    const res = createRes()
    const next = jest.fn()

    await authenticatePlatformUser(req, res, next)

    expect(validatePlatformAccessToken).toHaveBeenCalledWith('bad-token')
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('sets req.user when validation succeeds', async () => {
    validatePlatformAccessToken.mockResolvedValue({
      directoryUserId: 'dir-123',
      userId: 'u-1',
      id: 'u-1',
      organizationId: 'org-1',
      primaryRole: 'learner',
      isTrainer: false,
      isSystemAdmin: false,
      rawClaims: {}
    })

    const req = { headers: { authorization: 'Bearer good-token' } }
    const res = createRes()
    const next = jest.fn()

    await authenticatePlatformUser(req, res, next)

    expect(req.user.directoryUserId).toBe('dir-123')
    expect(next).toHaveBeenCalled()
  })
})

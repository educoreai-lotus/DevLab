import { jest } from '@jest/globals'

describe('platformAuthController.getAuthContext', () => {
  let platformAuthController

  beforeAll(async () => {
    ;({ platformAuthController } = await import('../platformAuthController.js'))
  })

  const createRes = () => {
    const res = {}
    res.status = jest.fn(() => res)
    res.json = jest.fn(() => res)
    return res
  }

  it('returns safe authenticated context fields', async () => {
    const req = {
      user: {
        directoryUserId: 'dir-123',
        userId: 'dir-123',
        id: 'dir-123',
        role: 'employee',
        primaryRole: 'EMPLOYEE',
        isTrainer: false,
        isSystemAdmin: false
      }
    }
    const res = createRes()

    await platformAuthController.getAuthContext(req, res)

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        directoryUserId: 'dir-123',
        userId: 'dir-123',
        id: 'dir-123',
        role: 'employee',
        primaryRole: 'EMPLOYEE',
        isTrainer: false,
        isSystemAdmin: false,
        authenticated: true
      }
    })
  })

  it('returns 401 when directoryUserId is missing', async () => {
    const req = { user: {} }
    const res = createRes()

    await platformAuthController.getAuthContext(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
  })
})

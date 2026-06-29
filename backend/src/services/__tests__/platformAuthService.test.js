import {
  normalizePlatformUser,
  extractClaimsFromValidationPayload
} from '../platformAuthService.js'

describe('platformAuthService', () => {
  describe('normalizePlatformUser', () => {
    it('maps directory_user_id to directoryUserId', () => {
      const user = normalizePlatformUser({
        directory_user_id: 'dir-123',
        user_id: 'u-1',
        primary_role: 'learner'
      })

      expect(user).toEqual({
        directoryUserId: 'dir-123',
        userId: 'u-1',
        id: null,
        organizationId: null,
        primaryRole: 'learner',
        isTrainer: false,
        isSystemAdmin: false,
        rawClaims: {
          directory_user_id: 'dir-123',
          user_id: 'u-1',
          primary_role: 'learner'
        }
      })
    })

    it('maps directoryUserId camelCase', () => {
      const user = normalizePlatformUser({
        directoryUserId: 'dir-456',
        userId: 'u-2'
      })

      expect(user?.directoryUserId).toBe('dir-456')
      expect(user?.userId).toBe('u-2')
    })

    it('returns null when directory user id is missing', () => {
      expect(normalizePlatformUser({ sub: 'jwt-subject' })).toBeNull()
    })
  })

  describe('extractClaimsFromValidationPayload', () => {
    it('unwraps nested coordinator response payloads', () => {
      const user = extractClaimsFromValidationPayload({
        response: {
          data: {
            directoryUserId: 'dir-789',
            organizationId: 'org-1'
          }
        }
      })

      expect(user?.directoryUserId).toBe('dir-789')
      expect(user?.organizationId).toBe('org-1')
    })
  })
})

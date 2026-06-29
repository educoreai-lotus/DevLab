import { validatePlatformAccessToken } from '../services/platformAuthService.js'

/**
 * @typedef {Object} PlatformUser
 * @property {string} directoryUserId
 * @property {string|null} [userId]
 * @property {string|null} [id]
 * @property {string|null} [organizationId]
 * @property {string|null} [primaryRole]
 * @property {boolean} [isTrainer]
 * @property {boolean} [isSystemAdmin]
 * @property {Record<string, unknown>} [rawClaims]
 */

/**
 * Authenticate a platform user JWT (Directory / nAuth) via Coordinator or NAUTH_BASE_URL.
 * Sets req.user with directoryUserId for learner-scoped competition actions.
 */
export const authenticatePlatformUser = async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization
  const token =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : null

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access token required'
    })
  }

  try {
    const user = await validatePlatformAccessToken(token)
    req.user = user
    return next()
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 401
    const message =
      status === 503
        ? 'Platform authentication is unavailable'
        : status === 403
          ? 'Platform user identity not available'
          : 'Invalid or expired token'

    return res.status(status).json({
      success: false,
      error: message
    })
  }
}

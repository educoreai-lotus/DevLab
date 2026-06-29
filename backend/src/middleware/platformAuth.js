import { validatePlatformAccessToken } from '../services/platformAuthService.js'

const deriveRole = (validation) => {
  const primaryRole = validation.primary_role || validation.primaryRole
  if (typeof primaryRole === 'string' && primaryRole.trim()) {
    return primaryRole.trim().toLowerCase()
  }
  if (validation.is_system_admin || validation.isSystemAdmin) {
    return 'admin'
  }
  if (validation.is_trainer || validation.isTrainer) {
    return 'trainer'
  }
  return 'learner'
}

/**
 * Authenticate a platform user JWT via Coordinator /request (Course Builder pattern).
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
    const validation = await validatePlatformAccessToken(token, {
      route: req.originalUrl || req.url || '',
      method: req.method || 'GET'
    })

    const directoryUserId =
      validation.directory_user_id || validation.directoryUserId

    if (!directoryUserId) {
      return res.status(401).json({
        success: false,
        error: 'Platform user identity not available'
      })
    }

    const directoryUserIdText = String(directoryUserId)
    const role = deriveRole(validation)

    req.user = {
      directoryUserId: directoryUserIdText,
      userId: directoryUserIdText,
      id: directoryUserIdText,
      organizationId:
        validation.organization_id || validation.organizationId || null,
      primaryRole: validation.primary_role || validation.primaryRole || null,
      isTrainer: Boolean(validation.is_trainer ?? validation.isTrainer),
      isSystemAdmin: Boolean(
        validation.is_system_admin ?? validation.isSystemAdmin
      ),
      role,
      source: 'coordinator-nauth'
    }

    const rotatedToken = validation.new_access_token
    if (typeof rotatedToken === 'string' && rotatedToken.trim()) {
      res.setHeader('X-New-Access-Token', rotatedToken.trim())
    }

    return next()
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 401
    const message =
      status === 503
        ? 'Platform authentication is unavailable'
        : error.message || 'Invalid or expired token'

    return res.status(status).json({
      success: false,
      error: message
    })
  }
}

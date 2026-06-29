import axios from 'axios'
import { postToCoordinator } from '../infrastructure/coordinatorClient/coordinatorClient.js'

const SERVICE_NAME = process.env.SERVICE_NAME || 'devlab-service'

/**
 * @param {Record<string, unknown>} claims
 * @returns {import('../middleware/platformAuth.js').PlatformUser | null}
 */
export function normalizePlatformUser(claims) {
  if (!claims || typeof claims !== 'object') {
    return null
  }

  const directoryUserId =
    claims.directoryUserId ||
    claims.directory_user_id ||
    null

  if (!directoryUserId) {
    return null
  }

  return {
    directoryUserId: String(directoryUserId),
    userId: claims.userId || claims.user_id || null,
    id: claims.id != null ? String(claims.id) : null,
    organizationId: claims.organizationId || claims.organization_id || null,
    primaryRole: claims.primaryRole || claims.primary_role || null,
    isTrainer: Boolean(claims.isTrainer ?? claims.is_trainer),
    isSystemAdmin: Boolean(claims.isSystemAdmin ?? claims.is_system_admin),
    rawClaims: claims
  }
}

/**
 * Unwrap Coordinator / nAuth validation payloads into a claims object.
 * @param {unknown} payload
 */
export function extractClaimsFromValidationPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const root = /** @type {Record<string, unknown>} */ (payload)

  if (root.authenticated === false) {
    return null
  }

  const candidates = [
    root,
    root.data,
    root.user,
    root.claims,
    root.response,
    root.response && typeof root.response === 'object' ? root.response.data : null,
    root.response && typeof root.response === 'object' ? root.response.user : null,
    root.response && typeof root.response === 'object' ? root.response.claims : null,
    root.payload,
    root.payload && typeof root.payload === 'object' ? root.payload.data : null,
    root.payload && typeof root.payload === 'object' ? root.payload.user : null
  ]

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      continue
    }
    const normalized = normalizePlatformUser(/** @type {Record<string, unknown>} */ (candidate))
    if (normalized) {
      return normalized
    }
  }

  return null
}

/**
 * Validate a platform access token via nAuth (direct) or Coordinator proxy.
 * Does not use local JWT_SECRET.
 * @param {string} token
 */
export async function validatePlatformAccessToken(token) {
  if (!token || typeof token !== 'string') {
    throw Object.assign(new Error('Access token required'), { status: 401 })
  }

  const nauthBaseUrl = process.env.NAUTH_BASE_URL
  if (nauthBaseUrl) {
    const contextPath = process.env.NAUTH_AUTH_CONTEXT_PATH || '/api/auth/context'
    const url = `${nauthBaseUrl.replace(/\/$/, '')}${contextPath.startsWith('/') ? contextPath : `/${contextPath}`}`

    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: Number(process.env.PLATFORM_AUTH_TIMEOUT_MS || 10000),
      validateStatus: () => true
    })

    if (response.status < 200 || response.status >= 300) {
      throw Object.assign(new Error('Invalid or expired token'), { status: 401 })
    }

    const user = extractClaimsFromValidationPayload(response.data)
    if (!user?.directoryUserId) {
      throw Object.assign(new Error('Platform user identity not available'), { status: 403 })
    }

    return user
  }

  const coordinatorUrl = process.env.COORDINATOR_URL
  if (!coordinatorUrl) {
    throw Object.assign(new Error('Platform authentication is not configured'), { status: 503 })
  }

  const validateAction =
    process.env.PLATFORM_TOKEN_VALIDATE_ACTION || 'validate-access-token'
  const validateEndpoint =
    process.env.PLATFORM_TOKEN_VALIDATE_ENDPOINT || '/api/request/'

  const envelope = {
    requester_service: SERVICE_NAME,
    payload: {
      action: validateAction,
      access_token: token
    },
    response: {}
  }

  let coordinatorResponse
  try {
    coordinatorResponse = await postToCoordinator(envelope, { endpoint: validateEndpoint })
  } catch (error) {
    const status = error.response?.status
    if (status === 401 || status === 403) {
      throw Object.assign(new Error('Invalid or expired token'), { status: 401 })
    }
    throw Object.assign(new Error('Token validation failed'), { status: 503 })
  }

  const user = extractClaimsFromValidationPayload(coordinatorResponse)
  if (!user?.directoryUserId) {
    throw Object.assign(new Error('Platform user identity not available'), { status: 403 })
  }

  return user
}
